/* eslint-disable no-unused-vars */
const urlPrefix = '/services-manager';

// -------------- UI ------------------

function closePopup() {
  if (document.getElementById('dependentServiceOffModal')) {
    document.getElementById('dependentServiceOffModal').style.visibility = 'hidden';
  }
  if (document.getElementById('overlay')) {
    document.getElementById('overlay').classList.remove('active');
  }
}

function showModal(headerText, bodyText) {
  if (document.getElementById('overlay')) {
    document.getElementById('overlay').classList.add('active');
  }
  if (document.getElementById('dependentServiceOffModal')) {
    document.getElementById('dependentServiceOffModal').style.visibility = 'visible';
  }
  if (document.getElementById('dependentServiceOffModalHeader')) {
    document.getElementById('dependentServiceOffModalHeader').innerHTML = headerText;
  }
  if (document.getElementById('dependentServiceOffModalBody')) {
    document.getElementById('dependentServiceOffModalBody').innerHTML = bodyText;
  }
}

const stateColors = {
  serviceOn: '#dfffdf',
  serviceOff: 'lightgray',
  error: 'lightcoral',
};

function setColor(id, state) {
  document.getElementById(`serviceName${id}`).style['background-color'] = stateColors[state] || stateColors.error;
}

function getValueCheckbox(id) {
  return document.getElementById(`checkbox${id}`).checked;
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
  document.getElementById(`btnBigOn${id}`).setAttribute('disabled', 'disabled');
  document.getElementById(`btnOff${id}`).setAttribute('disabled', 'disabled');
  document.getElementById(`btnRestart${id}`).setAttribute('disabled', 'disabled');
  disableBigButtons();
}


function enableServiceButtons(id) {
  document.getElementById(`btnOn${id}`).removeAttribute('disabled');
  document.getElementById(`btnBigOn${id}`).removeAttribute('disabled');
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

function serviceAction(action, id, name, postAction, query = '') {
  console.log(action, id, name);
  enableLoadingIcon(id);
  disableServiceButtons(id);

  makeRequest(`/${action}/${name}${query}`, (err, resp) => {
    console.log(action, 'response', id, name, err, resp);
    disableLoadingIcon(id);
    enableServiceButtons(id);
    postAction(id, name, err, resp);
  });
}

function serviceOn(id, name, withDependencies) {
  const checked = getValueCheckbox(id);

  showModal('Внимание!', `Идёт запуск сервис${withDependencies ? 'ов' : 'а'} для работы ${name}!`);

  function postAction(i, n, err, resp) {
    const runServices = {
      ok: [
        'Сервисы включены:',
      ],
      error: [
        'Сервисы не включены:',
      ],
    };

    if (checked || withDependencies) {
      resp.items.forEach((item) => {
        const nameList = item.ok ? 'ok' : 'error';

        if (!item.id) {
          runServices[nameList].push(item.name || 'unknown_service');
          return;
        }
        if (item.name) {
          runServices[nameList].push(item.name);
        } else {
          runServices[nameList].push('unknown_service');
        }

        setColor(item.id, item.ok ? 'serviceOn' : 'error');
      });
    } else {
      setColor(id, resp.ok ? 'serviceOn' : 'error');
    }

    closePopup();

    if (checked || withDependencies) {
      showModal(
        'Внимание!',
        runServices.ok.concat(runServices.error.length === 1 ? [] : runServices.error).join('<br>'),
      );
    }
  }

  serviceAction('serviceOn', id, name, postAction, withDependencies ? '?withDependencies=true' : '');
}

function serviceOffWD(id, name) {
  function postAction(i, n, err, resp) {
    if (resp && Array.isArray(resp.parentsServices) && resp.parentsServices.length) {
      const attentionText = 'При выключении этого сервиса гарантируются проблемы со следующими сервисами:';
      showModal('Внимание!', `${attentionText} ${resp.parentsServices.join(',')}`);
    }

    resp.items.forEach((item) => {
      setColor(item.id, item.ok ? 'serviceOff' : 'error');
    });
  }
  serviceAction('serviceOffWD', id, name, postAction);
}

function serviceOffOne(id, name) {
  function postAction(i, n, err, resp) {
    setColor(id, resp.ok ? 'serviceOff' : 'error');
  }

  serviceAction('serviceOff', id, name, postAction);
}

function serviceOff(id, name) {
  const checked = getValueCheckbox(id);
  const method = checked ? serviceOffWD : serviceOffOne;

  method(id, name);
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

function killProcesses() {
  disableBigButtons();
  showModal('Внимание!', 'Идёт дроп ненужных sshd процессов');
  makeRequest('/killProcesses', (err, resp) => {
    console.log('killProcesses', 'response', err, resp);

    closePopup();

    if (err) {
      showModal('Внимание!', 'Что то пошло не так, повторите ещё раз');
    }

    setTimeout(() => {
      enableBigButtons();
    }, 1000);
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
      if (item.id) {
        setColor(item.id, color);
      }
    });

    closePopup();
    setTimeout(() => {
      enableBigButtons();
    }, 1000);
  });
}
