const express = require('express');
const { exec } = require('child_process');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml');
const uuid = require('uuid4');
// const mock = require('./mock');

const app = express();
const serviceExceptions = (process.env.EXCEPTIONS && process.env.EXCEPTIONS.split(',')) || [];
console.log(`Exceptions list: ${serviceExceptions.join()}`);
const MAP_SERVICES = {};

function mappingYaml(serviceName, yml) {
  if (!yml) {
    return 'Нет описания для сервиса.';
  }

  return `
    Описание: ${yml.description || ''}
    Родительские сервисы: ${MAP_SERVICES[serviceName].parents.join(',')}
    Дочерние сервисы: ${MAP_SERVICES[serviceName].childs.join(',')}
  `;
}

function createMapByYamlFiles(services) {
  services.forEach((service) => {
    if (!service.yamlFile) return;
    if (Array.isArray(service.yamlFile.parentalServices)) {
      MAP_SERVICES[service.name] = MAP_SERVICES[service.name] || { parents: [], childs: [] };

      service.yamlFile.parentalServices.forEach((parentalService) => {
        if (!MAP_SERVICES[service.name].parents.includes(parentalService)) {
          MAP_SERVICES[service.name].parents.push(parentalService);
        }
      });
    }
    if (Array.isArray(service.yamlFile.dependentServices)) {
      MAP_SERVICES[service.name] = MAP_SERVICES[service.name] || { parents: [], childs: [] };

      service.yamlFile.dependentServices.forEach((dependentService) => {
        if (!MAP_SERVICES[service.name].childs.includes(dependentService)) {
          MAP_SERVICES[service.name].childs.push(dependentService);
        }
      });
    }
  });
}

function getOnChildsServices(childsNames, infoObject) {
  childsNames.forEach((childName) => {
    if (infoObject.includes(childName)) return;

    infoObject.push(childName);
  });
}

const execCmd = async cmd => new Promise((resolve, reject) => {
  exec(cmd, (error, stdout /* , stderr */) => {
    if (error && error.code !== 1) {
      reject(error);
      return;
    }
    resolve(stdout);
  });
});

const getAvailableServices = async () => {
  const cmd = 'find /etc/service/* -type l -exec test -e {} \\; -exec /usr/bin/sudo /usr/bin/sv status {} \\;';
  const list = await execCmd(cmd);
  // list = mock.svStatusResult;
  return list
    .split('\n')
    .filter(line => Boolean(line))
    .map((line) => {
      const [status, path] = line.split(': ');
      const name = path.slice(13);

      MAP_SERVICES[name] = MAP_SERVICES[name] || { parents: [], childs: [] };
      // eslint-disable-next-line prefer-destructuring
      MAP_SERVICES[name].id = (MAP_SERVICES[name].id || uuid()).split('-')[0];
      MAP_SERVICES[name].status = status;

      return {
        id: MAP_SERVICES[name].id,
        path,
        name,
        status,
      };
    })
    .filter(service => !serviceExceptions.includes(service.name));
};

const getFileDataByRunFile = async (serviceName, runFilePath, nameFileService) => {
  const readFileAsync = Promise.promisify(fs.readFile);
  const statAsync = Promise.promisify(fs.stat);

  let data;

  try {
    data = await statAsync(runFilePath);
  } catch (e) {
    return undefined;
  }

  let fileData = await readFileAsync(runFilePath, 'utf-8');

  const firstIndex = fileData.indexOf('/home/twiket/');

  fileData = fileData.substr(firstIndex);

  const secondIndex = fileData.indexOf('current');

  let pathLog = fileData.substr(0, secondIndex) + nameFileService;

  try {
    data = await statAsync(pathLog);
  } catch (e) {
    data = undefined;
  }

  if (!data) {
    try {
      pathLog = `/home/twiket/${serviceName}/${nameFileService}`;
      data = await statAsync(pathLog);
    } catch (e) {
      return undefined;
    }
  }

  return readFileAsync(pathLog, 'utf-8');
};

const getYamlByNameService = async (nameService) => {
  const fileData = await getFileDataByRunFile(nameService, `/etc/sv/${nameService}/run`, 'current/onetwotrip.yaml');

  if (!fileData) {
    return;
  }

  // eslint-disable-next-line consistent-return
  return yaml.safeLoad(fileData);
};

const getAvailableServicesWithBranch = async () => {
  const availableServices = await getAvailableServices();

  const renewAvailableServices = availableServices.map((service) => {
    // eslint-disable-next-line no-param-reassign
    service.fileService = `${service.path.replace('service', 'sv')}/run`;
    return service;
  });

  // eslint-disable-next-line no-restricted-syntax
  for (const service of renewAvailableServices) {
    service.branch = 'unknown';

    // eslint-disable-next-line no-await-in-loop
    const fileData = await getFileDataByRunFile(service.name, service.fileService, 'revisions.log');

    // eslint-disable-next-line no-continue
    if (!fileData) continue;

    try {
      const splitData = fileData.split('\n').filter(Boolean);
      const splitLastData = splitData[splitData.length - 1].split(' ');
      const year = [
        splitLastData[7].substr(6, 2),
        splitLastData[7].substr(4, 2),
        splitLastData[7].substr(0, 4),
      ].join('.');
      const time = [
        splitLastData[7].substr(8, 2),
        splitLastData[7].substr(10, 2),
      ].join(':');

      service.branch = `${splitLastData[1]}(${splitLastData[3]} ${time} ${year}`;
      // eslint-disable-next-line no-await-in-loop
      service.yamlFile = await getYamlByNameService(service.name);
      service.yamlFileShow = mappingYaml(service.name, service.yamlFile);
    } catch (e) {
      console.log('getAvailableServicesWithBranch_error', e);
    }
  }

  createMapByYamlFiles(renewAvailableServices);

  return renewAvailableServices;
};

const chefStatus = async () => {
  const commandResult = await execCmd('/usr/bin/sudo pgrep chef-client');
  const rows = commandResult.split('\n').length;
  const status = rows > 2 ? 'run' : 'stopped';
  console.log(`chefStatus: ${status} ${rows} '${commandResult}'`);
  return status;
};

const hostname = async () => {
  const commandResult = await execCmd('/bin/hostname');
  return commandResult;
};

app.use(express.static('static'));
app.set('view engine', 'pug');

app.get('/', async (req, res) => {
  try {
    const servicesList = await getAvailableServicesWithBranch();

    res.render('index', {
      services: servicesList,
      chefService: {
        status: await chefStatus(),
        name: 'chef-client',
      },
      hostname: await hostname(),
      ok: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/chefStart', async (req, res) => {
  try {
    console.log('chefStart');
    // noinspection ES6MissingAwait
    execCmd('/usr/bin/sudo /usr/bin/chef-client'); // no wait
    res.json({
      ok: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/chefKill', async (req, res) => {
  try {
    const commandResult = await execCmd('/usr/bin/sudo killall -s 9 chef-client');
    console.log('chefKill', commandResult);
    res.json({
      ok: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});
// eslint-disable-next-line no-unused-vars
async function doDependentServices(nameService, command, skipStatus) {
  const parseFile = await getYamlByNameService(nameService);

  if (!parseFile || !parseFile.dependentServices) {
    return [];
  }

  const dependentServices = parseFile.dependentServices.filter(ds => !skipStatus
                                                                || MAP_SERVICES[ds].status !== skipStatus);
  const items = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const nameServiceSec of dependentServices) {
    console.log('doDependentServices', 'START', nameServiceSec);
    // eslint-disable-next-line no-await-in-loop
    const commandResult = await execCmd(`${command}${nameServiceSec}`);

    items.push(
      { id: MAP_SERVICES[nameServiceSec].id, ok: commandResult.startsWith('ok') || commandResult.startsWith('kill') },
    );
  }

  return items;
}

app.get('/killProcesses', async (req, res) => {
  try {
    const command = '/usr/bin/sudo ps axw|grep \'sshd[:]\' | awk \'{print $1}\' |xargs kill';
    const commandResult = await execCmd(command);

    res.json({
      ok: commandResult.startsWith('ok'),
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/killProcesses', async (req, res) => {
  try {
    const command = '/usr/bin/sudo ps axw|grep \'sshd[:]\' | awk \'{print $1}\' |xargs kill';
    const commandResult = await execCmd(command);

    res.json({
      ok: commandResult.startsWith('ok'),
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/serviceOn/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { withDependencies } = req.query;
    const command = '/usr/bin/sudo /usr/bin/sv start /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);

    const items = [];
    const startServices = [];

    getOnChildsServices(MAP_SERVICES[name].childs || [], startServices);

    MAP_SERVICES[name].status = 'run';

    if (startServices.length && withDependencies) {
      await Promise.map(
        startServices,
        async (needOn) => {
          if (name === needOn) return;
          try {
            const cmdResult = await execCmd(`${command}${needOn}`);
            items.push({
              id: MAP_SERVICES[needOn] && MAP_SERVICES[needOn].id,
              name: needOn,
              ok: cmdResult.startsWith('ok') || cmdResult.startsWith('kill'),
            });
          } catch (err) {
            items.push({
              name: needOn,
              err: err.message || err,
              ok: false,
            });
          }
        },
      );
    }

    items.push({
      id: MAP_SERVICES[name].id,
      name,
      ok: commandResult.startsWith('ok'),
    });

    // commandResult = mock.svStartResult;
    console.log(name, commandResult);
    res.json({
      items,
      ok: true,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/serviceOffWD/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);
    // commandResult =  mock.svStopResult;
    MAP_SERVICES[name].status = 'down';
    // eslint-disable-next-line no-mixed-operators
    const runParentServices = (MAP_SERVICES[name] && MAP_SERVICES[name].parents || [])
      .filter(parent => MAP_SERVICES[parent].status === 'run');
    const finishResult = {
      runParents: runParentServices.map(runParent => runParent.name),
      needOff: [name],
    };

    finishResult.needOff = finishResult.needOff.filter(serviceName => !finishResult.runParents.includes(serviceName));

    const items = [];

    if (finishResult.needOff.length) {
      await Promise.map(
        finishResult.needOff,
        async (needOff) => {
          try {
            const commandResultSec = await execCmd(`${command}${needOff}`);
            items.push({
              id: MAP_SERVICES[needOff] && MAP_SERVICES[needOff].id,
              name: needOff,
              ok: commandResultSec.startsWith('ok') || commandResultSec.startsWith('kill'),
            });
          } catch (err) {
            items.push({
              name: needOff,
              err: err.message || err,
              ok: false,
            });
          }
        },
      );
    }

    console.log(name, commandResult);
    res.json({
      parentsServices: runParentServices,
      name,
      ok: true,
      items,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/serviceOff/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);
    // commandResult =  mock.svStopResult;
    MAP_SERVICES[name].status = 'down';

    console.log(name, commandResult);
    res.json({
      name, ok: commandResult.startsWith('ok') || commandResult.startsWith('kill'),
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/serviceAll/:action', async (req, res) => {
  try {
    const { action } = req.params;
    let servicesList = await getAvailableServicesWithBranch();

    if (action !== 'RESTART') {
      const filterStatus = ['OFF', 'RESTART_ALIVE'].includes(action) ? 'run' : 'down';
      servicesList = servicesList.filter(service => service.status === filterStatus);
    }

    const items = await Promise.map(
      servicesList,
      async (service) => {
        console.log(`start for ${action}:`, service);

        let generalCommand = '/usr/bin/sudo /usr/bin/sv start /etc/service/';

        if (action === 'OFF') {
          generalCommand = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/';
        } else if (['RESTART_ALIVE', 'RESTART'].includes(action)) {
          generalCommand = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-restart /etc/service/';
        }

        MAP_SERVICES[service.name].status = action === 'OFF' ? 'down' : 'run';

        const commandResult = await execCmd(`${generalCommand}${service.name}`);

        console.log(`finish for ${action}:`, service);

        return {
          id: service.id,
          name: service.name,
          ok: commandResult.startsWith('ok') || commandResult.startsWith('kill'),
        };
      },
    );

    res.json({
      ok: true,
      items,
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.get('/serviceRestart/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-restart /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);

    MAP_SERVICES[name].status = 'run';

    console.log(name, commandResult);
    res.json({
      name, ok: commandResult.startsWith('ok') || commandResult.startsWith('kill'),
    });
  } catch (err) {
    console.log(err);
    res.json({ err: err.message || err, ok: false });
  }
});

app.listen(process.env.PORT || 3000);
