/* eslint-disable no-unused-vars */
const urlPrefix = '/services-manager';

// -------------- UI ------------------

function closePopup() {
  document.getElementById('dependentServiceOffModal').style.visibility = 'hidden';
  document.getElementById('overlay').classList.remove('active');
}

function showModal(headerText, bodyText) {
  document.getElementById('overlay').classList.add('active');
  document.getElementById('dependentServiceOffModal').style.visibility = 'visible';
  document.getElementById('dependentServiceOffModalHeader').innerHTML = headerText;
  document.getElementById('dependentServiceOffModalBody').innerHTML = bodyText;
}

const stateColors = {
  serviceOn: '#dfffdf',
  serviceOff: 'lightgray',
  error: 'lightcoral',
};

function setColor(id, state) {
  document.getElementById(`serviceName${id}`).style['background-color'] = stateColors[state] || stateColors.error;
}

function enableLoadingIcon(id) {
  console.log(`loader${id}`);
  document.getElementById(`loader${id}`).style.visibility = 'visible';
}

function disableLoadingIcon(id) {
  document.getElementById(`loader${id}`).style.visibility = 'hidden';
}

function disableBigButtons() {
  const bigButtons = document.getElementsByClassName('btnMass');
  Object.keys(bigButtons).forEach((id) => {
    bigButtons[id].setAttribute('disabled', 'disabled');
  });
}

function enableBigButtons() {
  const bigButtons = document.getElementsByClassName('btnMass');
  Object.keys(bigButtons).forEach((id) => {
    bigButtons[id].removeAttribute('disabled');
  });
}

function disableServiceButtons(id) {
  document.getElementById(`btnOn${id}`).setAttribute('disabled', 'disabled');
  document.getElementById(`btnOff${id}`).setAttribute('disabled', 'disabled');
  document.getElementById(`btnRestart${id}`).setAttribute('disabled', 'disabled');
  disableBigButtons();
}


function enableServiceButtons(id) {
  document.getElementById(`btnOn${id}`).removeAttribute('disabled');
  document.getElementById(`btnOff${id}`).removeAttribute('disabled');
  document.getElementById(`btnRestart${id}`).removeAttribute('disabled');
  enableBigButtons();
}

// -------------- NETWORK ------------------
function makeRequest(path, callback) {
  const xhttp = new XMLHttpRequest();
  // eslint-disable-next-line func-names
  xhttp.onreadystatechange = function () {
    if (this.readyState === 4) {
      let data;
      try {
        data = JSON.parse(this.responseText);
      } catch (err) {
        console.error(err);
      }
      callback(this.status !== 200, data);
    }
  };
  xhttp.open('GET', urlPrefix + path, true);
  xhttp.send();
}

// -------------- LOGIC ------------------

function serviceAction(action, id, name, postAction) {
  console.log(action, id, name);
  enableLoadingIcon(id);
  disableServiceButtons(id);

  makeRequest(`/${action}/${name}`, (err, resp) => {
    console.log(action, 'response', id, name, err, resp);
    disableLoadingIcon(id);
    enableServiceButtons(id);
    postAction(id, name, err, resp);
  });
}

function serviceOn(id, name) {
  function postAction(i, n, err, resp) {
    resp.items.forEach((item) => {
      setColor(item.id, item.ok ? 'serviceOn' : 'error');
    });
  }
  serviceAction('serviceOn', id, name, postAction);
}

function serviceOff(id, name) {
  function postAction(i, n, err, resp) {
    if (resp && Array.isArray(resp.parentsServices) && resp.parentsServices.length) {
      const attentionText = 'При выключении этого сервиса гарантируются проблемы со следующими сервисами:';
      showModal('Внимание!', `${attentionText} ${resp.parentsServices.join(',')}`);
    }

    resp.items.forEach((item) => {
      setColor(item.id, item.ok ? 'serviceOff' : 'error');
    });
  }
  serviceAction('serviceOff', id, name, postAction);
}

function serviceRestart(id, name) {
  function postAction(i, n, err, resp) {
    setColor(id, resp && resp.ok ? 'serviceOn' : 'error');
  }
  serviceAction('serviceRestart', id, name, postAction);
}

function reloadPage() {
  document.location = document.location;
}

function chefServiceOn() {
  enableLoadingIcon('ChefService');
  makeRequest('/chefStart', (err, resp) => {
    console.log('chefStart', 'response', err, resp);
    setTimeout(reloadPage, 1000);
  });
}

function chefServiceOff() {
  enableLoadingIcon('ChefService');
  makeRequest('/chefKill', (err, resp) => {
    console.log('chefKill', 'response', err, resp);
    setTimeout(reloadPage, 1000);
  });
}

function serviceAll(action) {
  disableBigButtons();

  const message = ['RESTART', 'RESTART_ALIVE'].includes(action) ? 'перезагрузка' : 'запуск';

  showModal('Внимание!', `Идёт ${action === 'OFF' ? 'выключение' : message} сервисов`);
  makeRequest(`/serviceAll/${action}`, (err, resp) => {
    console.log('serviceAll', 'response', err, resp);

    resp.items.forEach((item) => {
      let color = 'error';

      if (item.ok) {
        if (['ON', 'RESTART', 'RESTART_ALIVE'].includes(action)) {
          color = 'serviceOn';
        } else if (action === 'OFF') {
          color = 'serviceOff';
        }
      }

      setColor(item.id, color);
    });

    closePopup();
    setTimeout(() => {
      enableBigButtons();
    }, 1000);
  });
}
