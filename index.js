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

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

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
    if (!service.yamlFile || !Array.isArray(service.yamlFile.dependentServices)) return;

    MAP_SERVICES[service.name] = MAP_SERVICES[service.name] || { parents: [], childs: [] };

    service.yamlFile.dependentServices.forEach((dependentService) => {
      if (!MAP_SERVICES[service.name].childs.includes(dependentService)) {
        MAP_SERVICES[service.name].childs.push(dependentService);
      }

      MAP_SERVICES[dependentService] = MAP_SERVICES[dependentService] || { parents: [], childs: [] };

      if (!MAP_SERVICES[dependentService].parents.includes(service.name)) {
        MAP_SERVICES[dependentService].parents.push(service.name);
      }
    });
  });
}

function getOffChildsServices(offServiceName, childsNames, infoObject) {
  childsNames.forEach((childName) => {
    if (MAP_SERVICES[childName].status === 'down'
          || infoObject.runParents.includes(childName)
          || infoObject.needOff.includes(childName)) {
      return;
    }
    // 1. нет родителей и детей
    // 2 не входит в список родителей - защита от рекурсий
    if (!MAP_SERVICES[childName].parents.length
        && !MAP_SERVICES[childName].childs.length && !infoObject.runParents.includes(childName)) {
      if (!infoObject.needOff.includes(childName)) {
        infoObject.needOff.push(childName);
      }
      return;
    }

    const parents = MAP_SERVICES[childName].parents
      .filter(parent => parent.name !== offServiceName && parent.status === 'run')
      .map(parent => parent.name);

    parents.forEach((parent) => {
      if (!infoObject.runParents.includes(parent)) infoObject.runParents.push(parent);
    });

    if (!parents.length && !infoObject.needOff.includes(childName)) {
      infoObject.needOff.push(childName);
    }

    getOffChildsServices(offServiceName, clone(MAP_SERVICES[childName].childs), infoObject);
  });
}

function getOnChildsServices(childsNames, infoObject) {
  childsNames.forEach((childName) => {
    if (infoObject.includes(childName)) return;

    infoObject.push(childName);

    if (!MAP_SERVICES[childName].childs.length) return;

    getOnChildsServices(MAP_SERVICES[childName].childs, infoObject);
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
    res.json({ ok: false });
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
    res.json({ ok: false });
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
    res.json({ ok: false });
  }
});


const doDependentServices = async (nameService, command, skipStatus) => {
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
};

app.get('/serviceOn/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv start /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);

    const items = [];
    const startServices = [];

    getOnChildsServices(MAP_SERVICES[name].childs || [], startServices);

    MAP_SERVICES[name].status = 'run';

    if (startServices.length) {
      // eslint-disable-next-line no-restricted-syntax
      for (const needOn of startServices) {
        // eslint-disable-next-line no-await-in-loop
        const cmdResult = await execCmd(`${command}${needOn}`);
        items.push(
          { id: MAP_SERVICES[needOn].id, ok: cmdResult.startsWith('ok') || cmdResult.startsWith('kill') },
        );
      }
    }

    items.push({
      id: MAP_SERVICES[name].id,
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
    res.json({ ok: false });
  }
});

app.get('/serviceOff/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/';
    let commandResult = await execCmd(`${command}${name}`);
    // commandResult =  mock.svStopResult;
    MAP_SERVICES[name].status = 'down';
    // eslint-disable-next-line no-mixed-operators
    const runParentServices = (MAP_SERVICES[name] && MAP_SERVICES[name].parents || [])
      .filter(parent => MAP_SERVICES[parent].status === 'run');
    const finishResult = {
      runParents: runParentServices.map(runParent => runParent.name),
      needOff: [name],
    };
    // идём вниз по детям и ищем кого можно выключить
    getOffChildsServices(name, clone(MAP_SERVICES[name].childs), finishResult);

    finishResult.needOff = finishResult.needOff.filter(serviceName => !finishResult.runParents.includes(serviceName));

    const items = [];

    if (finishResult.needOff.length) {
      // eslint-disable-next-line no-restricted-syntax
      for (const needOff of finishResult.needOff) {
        // eslint-disable-next-line no-await-in-loop
        commandResult = await execCmd(`${command}${needOff}`);
        items.push(
          { id: MAP_SERVICES[needOff].id, ok: commandResult.startsWith('ok') || commandResult.startsWith('kill') },
        );
      }
    }

    console.log(name, commandResult);
    res.json({
      parentsServices: runParentServices,
      ok: true,
      items,
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.get('/serviceAll/:action', async (req, res) => {
  try {
    const { action } = req.params;
    let servicesList = await getAvailableServicesWithBranch();
    const items = [];

    if (action !== 'RESTART') {
      const filterStatus = ['OFF', 'RESTART_ALIVE'].includes(action) ? 'run' : 'down';
      servicesList = servicesList.filter(service => service.status === filterStatus);
    }

    await Promise.map(
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

        items.push({ id: service.id, ok: commandResult.startsWith('ok') || commandResult.startsWith('kill') });
      },
      {
        concurrency: 5,
      },
    );

    res.json({
      ok: true,
      items,
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.get('/serviceRestart/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-restart /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);
    // commandResult = exports.svRestartResult;
    try {
      await doDependentServices(name, command);
    } catch (e) {
      console.log('error restart dep services', e);
    }

    MAP_SERVICES[name].status = 'run';

    console.log(name, commandResult);
    res.json({
      ok: commandResult.startsWith('ok') || commandResult.startsWith('kill'),
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.listen(process.env.PORT || 3000);
