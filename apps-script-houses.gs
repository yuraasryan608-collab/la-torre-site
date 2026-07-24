/**
 * УПРАВЛЕНИЕ КАТАЛОГОМ ДОМОВ (файл houses.json в репозитории сайта)
 * ---------------------------------------------------------------------------
 * Этот код вставляется в тот же проект Apps Script, что обслуживает брони.
 * Админка (admin.html) присылает сюда изменения каталога, а этот скрипт
 * коммитит их на GitHub. Токен GitHub хранится в Script Properties и в
 * браузер никогда не попадает.
 *
 * ЧТО НУЖНО НАСТРОИТЬ ОДИН РАЗ:
 *   Настройки проекта -> Свойства скрипта -> добавить:
 *     GITHUB_TOKEN  = fine-grained токен с правом Contents: read and write
 *                     на репозиторий la-torre-site
 *     GITHUB_REPO   = yuraasryan608-collab/la-torre-site
 *   (ADMIN_PASSWORD там уже есть — он используется для входа в админку.)
 *
 * КАК ПОДКЛЮЧИТЬ К СУЩЕСТВУЮЩЕМУ КОДУ:
 *   1) Вставить весь этот файл в проект (можно отдельным файлом: + -> Скрипт).
 *   2) В своих doGet(e) и doPost(e) в самом начале добавить по одной строке:
 *
 *        function doGet(e) {
 *          var houses = handleHousesRequest_(e, e.parameter);   // <-- добавить
 *          if (houses) return houses;                           // <-- добавить
 *          ...остальной ваш код без изменений...
 *        }
 *
 *        function doPost(e) {
 *          var body = JSON.parse(e.postData.contents);
 *          var houses = handleHousesRequest_(e, body);          // <-- добавить
 *          if (houses) return houses;                           // <-- добавить
 *          ...остальной ваш код без изменений...
 *        }
 *
 *   3) Развернуть -> Управление развёртываниями -> карандаш -> Версия: новая
 *      -> Развернуть. Адрес /exec останется прежним.
 */

var GH_BRANCH = 'main';

/** Проверяет, относится ли запрос к каталогу домов. Если да — обрабатывает. */
function handleHousesRequest_(e, params) {
  var action = params && params.action;
  var HOUSE_ACTIONS = {
    housesList: 1, houseSave: 1, houseVisible: 1,
    houseDelete: 1, housePhotoDelete: 1, housePhotoCover: 1
  };
  if (!action || !HOUSE_ACTIONS[action]) return null; // не наш запрос

  try {
    // Список домов админка запрашивает и до ввода пароля — он не секретный
    if (action !== 'housesList') {
      var stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
      if (!stored || String(params.pass || '') !== String(stored)) {
        return jsonOut_({ ok: false, error: 'Неверный пароль' });
      }
    }
    if (action === 'housesList')      return jsonOut_(housesList_());
    if (action === 'houseSave')       return jsonOut_(houseSave_(params));
    if (action === 'houseVisible')    return jsonOut_(houseVisible_(params));
    if (action === 'houseDelete')     return jsonOut_(houseDelete_(params));
    if (action === 'housePhotoDelete')return jsonOut_(housePhotoDelete_(params));
    if (action === 'housePhotoCover') return jsonOut_(housePhotoCover_(params));
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
//  Работа с GitHub
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
  options.headers = {
    Authorization: 'Bearer ' + p.token,
    Accept: 'application/vnd.github+json'
  };
  options.muteHttpExceptions = true;
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('GitHub ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

/** Читает файл из репозитория: { content, sha } или null */
function ghGetFile_(path) {
  var p = ghProps_();
  var url = 'https://api.github.com/repos/' + p.repo + '/contents/' + path +
            '?ref=' + GH_BRANCH + '&t=' + Date.now();
  var data = ghFetch_(url);
  if (!data) return null;
  var bytes = Utilities.base64Decode(data.content.replace(/\n/g, ''));
  return { content: Utilities.newBlob(bytes).getDataAsString('UTF-8'), sha: data.sha };
}

/** Создаёт или обновляет файл */
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
  var json = JSON.stringify(data, null, 2);
  var base64 = Utilities.base64Encode(json, Utilities.Charset.UTF_8);
  return ghPutFile_('houses.json', base64, message, sha);
}

function findHouse_(houses, id) {
  for (var i = 0; i < houses.length; i++) {
    if (Number(houses[i].id) === Number(id)) return houses[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
//  Действия админки
// ---------------------------------------------------------------------------

function housesList_() {
  var r = readHouses_();
  return { ok: true, houses: r.data.houses || [] };
}

/** Сохранить дом (создать новый или изменить существующий) + новые фото */
function houseSave_(params) {
  var r = readHouses_();
  var houses = r.data.houses || [];
  var house;

  if (params.id === null || params.id === undefined || params.id === '') {
    var maxId = 0;
    for (var i = 0; i < houses.length; i++) maxId = Math.max(maxId, Number(houses[i].id) || 0);
    house = { id: maxId + 1, name: '', price: 0, address: '', description: '',
              bedrooms: 0, visible: true, photos: [] };
    houses.push(house);
  } else {
    house = findHouse_(houses, params.id);
    if (!house) return { ok: false, error: 'Дом не найден' };
  }

  if (params.name        !== undefined) house.name = String(params.name);
  if (params.price       !== undefined) house.price = Number(params.price) || 0;
  if (params.address     !== undefined) house.address = String(params.address);
  if (params.description !== undefined) house.description = String(params.description);
  if (params.bedrooms    !== undefined) house.bedrooms = Number(params.bedrooms) || 0;
  if (!house.photos) house.photos = [];

  // Новые фото кладём в img/houses/house-NN/ отдельными коммитами
  var photos = params.photosBase64 || [];
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

/** Скрыть или показать дом на сайте (данные и фото сохраняются) */
function houseVisible_(params) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], params.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  house.visible = (params.visible === true || params.visible === 'true');
  writeHouses_(r.data, r.sha, 'Админка: дом ' + params.id + (house.visible ? ' показан' : ' скрыт'));
  return { ok: true };
}

/** Удалить дом навсегда вместе с фото */
function houseDelete_(params) {
  var r = readHouses_();
  var houses = r.data.houses || [];
  var idx = -1;
  for (var i = 0; i < houses.length; i++) {
    if (Number(houses[i].id) === Number(params.id)) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, error: 'Дом не найден' };

  var house = houses[idx];
  houses.splice(idx, 1);
  writeHouses_(r.data, r.sha, 'Админка: удалён дом «' + house.name + '» (id ' + params.id + ')');

  // Фото удаляем после записи houses.json: если что-то упадёт,
  // каталог уже корректен, останутся лишь неиспользуемые файлы.
  var photos = house.photos || [];
  for (var j = 0; j < photos.length; j++) {
    try { ghDeleteFile_(photos[j], 'Админка: удалено фото дома ' + params.id); } catch (err) {}
  }
  return { ok: true };
}

function housePhotoDelete_(params) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], params.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  var kept = [];
  for (var i = 0; i < (house.photos || []).length; i++) {
    if (house.photos[i] !== params.path) kept.push(house.photos[i]);
  }
  house.photos = kept;
  writeHouses_(r.data, r.sha, 'Админка: удалено фото дома ' + params.id);
  try { ghDeleteFile_(params.path, 'Админка: удалено фото дома ' + params.id); } catch (err) {}
  return { ok: true };
}

/** Сделать фото главным — оно станет обложкой карточки на сайте */
function housePhotoCover_(params) {
  var r = readHouses_();
  var house = findHouse_(r.data.houses || [], params.id);
  if (!house) return { ok: false, error: 'Дом не найден' };
  var rest = [];
  for (var i = 0; i < (house.photos || []).length; i++) {
    if (house.photos[i] !== params.path) rest.push(house.photos[i]);
  }
  house.photos = [params.path].concat(rest);
  writeHouses_(r.data, r.sha, 'Админка: главное фото дома ' + params.id);
  return { ok: true };
}
