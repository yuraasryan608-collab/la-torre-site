/**
 * УПРАВЛЕНИЕ КАТАЛОГОМ ДОМОВ (файл houses.json в репозитории сайта)
 * ===========================================================================
 * Вставляется в тот же проект Apps Script, что обслуживает брони.
 * Использует твои существующие функции jsonOut_ и checkAdmin_ — их дублировать
 * не нужно. Токен GitHub хранится в Свойствах скрипта и в браузер не попадает.
 *
 * НАСТРОИТЬ ОДИН РАЗ:
 *   Настройки проекта (шестерёнка) -> Свойства скрипта -> добавить:
 *     GITHUB_TOKEN = fine-grained токен с правом Contents: read and write
 *                    на репозиторий la-torre-site
 *     GITHUB_REPO  = yuraasryan608-collab/la-torre-site
 *
 * ПОДКЛЮЧЕНИЕ. Добавь по одной строке в свои doGet и doPost (в booking.gs):
 *
 *   в doGet(e), после строки  const action = e.parameter.action;
 *       if (action === 'housesList') return housesGet_(e);
 *
 *   в doPost(e), после строки  const payload = JSON.parse(e.postData.contents);
 *       if (payload.type && payload.type.indexOf('house') === 0) return housesPost_(payload);
 */

var GH_BRANCH = 'main';

// --- вызывается из doGet ---------------------------------------------------
function housesGet_(e) {
  // Публичный список для админки (до ввода пароля он не секретный)
  return jsonOut_(housesList_());
}

// --- вызывается из doPost --------------------------------------------------
function housesPost_(payload) {
  try {
    if (!checkAdmin_(payload.pass)) return jsonOut_({ ok: false, error: 'unauthorized' });
    var t = payload.type;
    if (t === 'houseSave')        return jsonOut_(houseSave_(payload));
    if (t === 'houseVisible')     return jsonOut_(houseVisible_(payload));
    if (t === 'houseDelete')      return jsonOut_(houseDelete_(payload));
    if (t === 'housePhotoDelete') return jsonOut_(housePhotoDelete_(payload));
    if (t === 'housePhotoCover')  return jsonOut_(housePhotoCover_(payload));
    return jsonOut_({ ok: false, error: 'unknown_house_action' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
//  GitHub
// ---------------------------------------------------------------------------
function ghProps_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('GITHUB_TOKEN');
  var repo  = props.getProperty('GITHUB_REPO');
  if (!token) throw new Error('В свойствах скрипта не задан GITHUB_TOKEN');
  if (!repo)  throw new Error('В свойствах скрипта не задан GITHUB_REPO');
  return { token: token, repo: repo };
}

function ghFetch_(url, options) {
  var p = ghProps_();
  options = options || {};
  options.headers = { Authorization: 'Bearer ' + p.token, Accept: 'application/vnd.github+json' };
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('GitHub ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function ghGetFile_(path) {
  var p = ghProps_();
  var url = 'https://api.github.com/repos/' + p.repo + '/contents/' + path + '?ref=' + GH_BRANCH + '&t=' + Date.now();
  var data = ghFetch_(url);
  if (!data) return null;
  var bytes = Utilities.base64Decode(data.content.replace(/\n/g, ''));
  return { content: Utilities.newBlob(bytes).getDataAsString('UTF-8'), sha: data.sha };
}

function ghPutFile_(path, base64Content, message, sha) {
  var p = ghProps_();
  var payload = { message: message, content: base64Content, branch: GH_BRANCH };
  if (sha) payload.sha = sha;
  return ghFetch_('https://api.github.com/repos/' + p.repo + '/contents/' + path, {
    method: 'put', contentType: 'application/json', payload: JSON.stringify(payload)
  });
}

function ghDeleteFile_(path, message) {
  var file = ghGetFile_(path);
  if (!file) return;
  var p = ghProps_();
  ghFetch_('https://api.github.com/repos/' + p.repo + '/contents/' + path, {
    method: 'delete', contentType: 'application/json',
    payload: JSON.stringify({ message: message, sha: file.sha, branch: GH_BRANCH })
  });
}

function readHouses_() {
  var file = ghGetFile_('houses.json');
  if (!file) return { data: { updated: '', houses: [] }, sha: null };
  return { data: JSON.parse(file.content), sha: file.sha };
}

function writeHouses_(data, sha, message) {
  data.updated = Utilities.formatDate(new Date(), 'Asia/Yerevan', 'yyyy-MM-dd');
  var base64 = Utilities.base64Encode(JSON.stringify(data, null, 2), Utilities.Charset.UTF_8);
  return ghPutFile_('houses.json', base64, message, sha);
}

function findHouse_(houses, id) {
  for (var i = 0; i < houses.length; i++) {
    if (Number(houses[i].id) === Number(id)) return houses[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Действия
// ---------------------------------------------------------------------------
function housesList_() {
  var r = readHouses_();
  return { ok: true, houses: r.data.houses || [] };
}

function houseSave_(payload) {
  var r = readHouses_();
  var houses = r.data.houses || [];
  var house;

  if (payload.id === null || payload.id === undefined || payload.id === '') {
    var maxId = 0;
    for (var i = 0; i < houses.length; i++) maxId = Math.max(maxId, Number(houses[i].id) || 0);
    house = { id: maxId + 1, name: '', price: 0, address: '', description: '', bedrooms: 0, visible: true, photos: [] };
    houses.push(house);
  } else {
    house = findHouse_(houses, payload.id);
    if (!house) return { ok: false, error: 'Дом не найден' };
  }

  if (payload.name        !== undefined) house.name = String(payload.name);
  if (payload.price       !== undefined) house.price = Number(payload.price) || 0;
  if (payload.address     !== undefined) house.address = String(payload.address);
  if (payload.description !== undefined) house.description = String(payload.description);
  if (payload.bedrooms    !== undefined) house.bedrooms = Number(payload.bedrooms) || 0;
  if (!house.photos) house.photos = [];

  var photos = payload.photosBase64 || [];
  if (photos.length) {
    var num = ('0' + house.id).slice(-2);
    var folder = 'img/houses/house-' + num;
    var maxNum = 0;
    for (var j = 0; j < house.photos.length; j++) {
      var m = String(house.photos[j]).match(/\/(\d+)\.jpg$/);
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    for (var k = 0; k < photos.length; k++) {
      maxNum++;
      var path = folder + '/' + maxNum + '.jpg';
      ghPutFile_(path, photos[k], 'Админка: фото для дома ' + house.id);
      house.photos.push(path);
    }
  }

  writeHouses_(r.data, r.sha, 'Админка: сохранён дом «' + house.name + '» (id ' + house.id + ')');
  return { ok: true, id: house.id };
}

function houseVisible_(payload) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], payload.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  house.visible = (payload.visible === true || payload.visible === 'true');
  writeHouses_(r.data, r.sha, 'Админка: дом ' + payload.id + (house.visible ? ' показан' : ' скрыт'));
  return { ok: true };
}

function houseDelete_(payload) {
  var r = readHouses_();
  var houses = r.data.houses || [];
  var idx = -1;
  for (var i = 0; i < houses.length; i++) {
    if (Number(houses[i].id) === Number(payload.id)) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, error: 'Дом не найден' };

  var house = houses[idx];
  houses.splice(idx, 1);
  writeHouses_(r.data, r.sha, 'Админка: удалён дом «' + house.name + '» (id ' + payload.id + ')');

  var photos = house.photos || [];
  for (var j = 0; j < photos.length; j++) {
    try { ghDeleteFile_(photos[j], 'Админка: удалено фото дома ' + payload.id); } catch (err) {}
  }
  return { ok: true };
}

function housePhotoDelete_(payload) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], payload.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  var kept = [];
  for (var i = 0; i < (house.photos || []).length; i++) {
    if (house.photos[i] !== payload.path) kept.push(house.photos[i]);
  }
  house.photos = kept;
  writeHouses_(r.data, r.sha, 'Админка: удалено фото дома ' + payload.id);
  try { ghDeleteFile_(payload.path, 'Админка: удалено фото дома ' + payload.id); } catch (err) {}
  return { ok: true };
}

function housePhotoCover_(payload) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], payload.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  var rest = [];
  for (var i = 0; i < (house.photos || []).length; i++) {
    if (house.photos[i] !== payload.path) rest.push(house.photos[i]);
  }
  house.photos = [payload.path].concat(rest);
  writeHouses_(r.data, r.sha, 'Админка: главное фото дома ' + payload.id);
  return { ok: true };
}
