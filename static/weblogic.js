const urlPrefix = '/services-manager';

function serviceOn(id, name) {
  serviceAction('serviceOn', id, name, postAction);
  function postAction(id, name, err, resp) {
    setColor(id, resp && resp.ok ? 'serviceOn' : 'error');
  }
}

function serviceOff(id, name) {
  serviceAction('serviceOff', id, name, postAction);
  function postAction(id, name, err, resp) {
    setColor(id, resp && resp.ok ? 'serviceOff' : 'error');
  }
}

function serviceRestart(id, name) {
  serviceAction('serviceRestart', id, name, postAction);
  function postAction(id, name, err, resp) {
    setColor(id, resp && resp.ok ? 'serviceOn' : 'error');
  }
}

function serviceAction(action, id, name, postAction) {
  console.log(action, id, name);
  enableLoadingIcon(id);
  disableServiceButtons(id);

  makeRequest('/' + action + '/' + name, function(err, resp) {
    console.log(action, 'response', id, name, err, resp);
    disableLoadingIcon(id);
    enableServiceButtons(id);
    postAction(id, name, err, resp);
  });
}

function reloadPage() {
  document.location = document.location;
}

function chefServiceOn() {
  enableLoadingIcon('ChefService');
  makeRequest('/chefStart', function(err, resp) {
    console.log('chefStart', 'response', err, resp);
    setTimeout(reloadPage, 1000);
  });
}

function chefServiceOff() {
  enableLoadingIcon('ChefService');
  makeRequest('/chefKill', function(err, resp) {
    console.log('chefKill', 'response', err, resp);
    setTimeout(reloadPage, 1000);
  });
}

function serviceAll(action) {
  disableBigButtons();

  makeRequest(`/serviceAll/${action}`, function(err, resp){
    console.log('serviceAll', 'response', err, resp);

    resp.items.forEach((item, id) => {
      let color = 'error';

      if(item){
        if(action === 'ON'){
          color = 'serviceOn';
        }
        else if(action === 'OFF'){
          color = 'serviceOff'
        }
      }

      setColor(id, color);
    });

    setTimeout(function(){
      enableBigButtons();
    }, 1000);
  });
}

// -------------- UI ------------------
const stateColors = {
  serviceOn: '#dfffdf',
  serviceOff: 'lightgray',
  error: 'lightcoral',
};

function setColor (id, state) {
  document.getElementById('serviceName' + id).style['background-color'] = stateColors[state] || stateColors.error;
}

function enableLoadingIcon(id) {
  console.log('loader' + id)
  document.getElementById('loader' + id).style.visibility = "visible";
}

function disableLoadingIcon(id) {
  document.getElementById('loader' + id).style.visibility = "hidden";
}

function disableServiceButtons(id) {
  document.getElementById('btnOn' + id).setAttribute('disabled', 'disabled');
  document.getElementById('btnOff' + id).setAttribute('disabled', 'disabled');
  document.getElementById('btnRestart' + id).setAttribute('disabled', 'disabled');
  disableBigButtons();
}

function disableBigButtons() {
  const bigButtons = document.getElementsByClassName('btnAll');
  Object.keys(bigButtons).forEach(function(id) {
    bigButtons[id].setAttribute('disabled', 'disabled');
  });
}

function enableServiceButtons(id) {
  document.getElementById('btnOn' + id).removeAttribute('disabled');
  document.getElementById('btnOff' + id).removeAttribute('disabled');
  document.getElementById('btnRestart' + id).removeAttribute('disabled');
  enableBigButtons();
}

function enableBigButtons() {
  let bigButtons = document.getElementsByClassName('btnAll');
  Object.keys(bigButtons).forEach(function(id) {
    bigButtons[id].removeAttribute('disabled');
  });
}

// -------------- NETWORK ------------------
function makeRequest(path, callback) {
  const xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (this.readyState == 4) {
      let data;
      try {
        data = JSON.parse(this.responseText);
      } catch (err) {
        console.error(err);
      }
      callback(this.status !== 200, data);
    }
  };
  xhttp.open("GET", urlPrefix + path, true);
  xhttp.send();
}