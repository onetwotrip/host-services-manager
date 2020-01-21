const express = require('express');
const { exec } = require('child_process');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml')
// const mock = require('./mock');

const app = express();
const serviceExceptions = (process.env.EXCEPTIONS && process.env.EXCEPTIONS.split(',')) || [];
console.log(`Exceptions list: ${serviceExceptions.join()}`);
const MAP_SERVICES = {};

function createMapByYamlFiles(services){
  services.forEach((service) => {
    if(!service.yamlFile || !Array.isArray(service.yamlFile.dependentServices)) return;

    MAP_SERVICES[service.name] = MAP_SERVICES[service.name] || {parents: [], childs: []};

    service.yamlFile.dependentServices.forEach((dependentService) => {
      MAP_SERVICES[service.name].childs.push(dependentService);
      MAP_SERVICES[dependentService] = MAP_SERVICES[dependentService] || {parents: [], childs: []};
      MAP_SERVICES[dependentService].parents.push(service.name);
    });
  });
}

const execCmd = async cmd =>
  new Promise((resolve, reject) => {
    exec(cmd, (error, stdout /* , stderr */) => {
      if (error && error.code !== 1) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

const getAvailableServices = async () => {
  const list = await execCmd('find /etc/service/* -type l -exec test -e {} \\; -exec /usr/bin/sudo /usr/bin/sv status {} \\;');
  // list = mock.svStatusResult;
  return 'off: /etc/service/avia'/*list*/
    .split('\n')
    .filter(line => Boolean(line))
    .map((line) => {
      const [status, path] = line.split(': ');
      return {
        path,
        name: path.slice(13),
        status,
      };
    })
    .filter(service => !serviceExceptions.includes(service.name));
};

const getFileDataByRunFile = async (serviceName, runFilePath, nameFileService) => {
  const readFileAsync = Promise.promisify(fs.readFile);
  const statAsync = Promise.promisify(fs.stat);

  let data;

  try{
    data = await statAsync(runFilePath);
  }
  catch(e){
    return undefined;
  }

  let fileData = await readFileAsync(runFilePath, 'utf-8');

  const firstIndex = fileData.indexOf('/home/aleksandr/Project/');

  fileData = fileData.substr(firstIndex);

  const secondIndex = fileData.indexOf('current');

  let pathLog = fileData.substr(0, secondIndex) + nameFileService;

  try{
    data = await statAsync(pathLog);
  }
  catch(e){
    data = undefined;
  }

  if(!data){
    try{
      pathLog = `/home/aleksandr/Project/${serviceName}/${nameFileService}`;
      data = await statAsync(pathLog);
    }
    catch(e){
      return undefined;
    }
  }

  return readFileAsync(pathLog, 'utf-8');
};

const getAvailableServicesWithBranch = async () => {
  let availableServices = await getAvailableServices();

  const renewAvailableServices = availableServices.map((service) => {
    service.fileService = `${service.path.replace('service', 'sv')}/run`;
    return service;
  });

  for(const service of renewAvailableServices){
    service.branch = 'unknown';

    const fileData = await getFileDataByRunFile(service.name, service.fileService, 'revisions.log');

    if(!fileData) continue;

    try{
      const splitData = fileData.split('\n').filter(Boolean);
      const splitLastData = splitData[splitData.length - 1].split(' ');
      const year = [
        splitLastData[7].substr(6, 2),
        splitLastData[7].substr(4, 2),
        splitLastData[7].substr(0, 4)
      ].join('.');
      const time = [
        splitLastData[7].substr(10, 2),
        splitLastData[7].substr(8, 2)
      ].join(':');

      service.branch = `${splitLastData[1]}(${splitLastData[3]} ${time} ${year}`;
      service.yamlFile = await getYamlByNameService(service.name);
    }
    catch(e){
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

const getYamlByNameService = async (nameService) => {
  const fileData = await getFileDataByRunFile(nameService, `/etc/sv/${nameService}/run`, 'current/onetwotrip.yaml');

  if(!fileData){
    return;
  }

  return yaml.safeLoad(fileData);
};

const doDependentServices = async (nameService, command) => {
  const parseFile = await getYamlByNameService(nameService);

  if(!parseFile.dependentServices){
    return;
  }

  for(const nameServiceSec of parseFile.dependentServices){
    await execCmd(`${command}${nameServiceSec}`)
  }
};

app.get('/serviceOn/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const command = '/usr/bin/sudo /usr/bin/sv start /etc/service/';
    const commandResult = await execCmd(`${command}${name}`);
    try{
      await doDependentServices(name, command);
    }
    catch(e){
      console.log('error start dep services', e);
    }
    // commandResult = mock.svStartResult;
    console.log(name, commandResult);
    res.json({
      ok: commandResult.startsWith('ok'),
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
    const commandResult = await execCmd(`${command}${name}`);
    try{
      await doDependentServices(name, command);
    }
    catch(e){
      console.log('error stop dep services', e);
    }
    // commandResult =  mock.svStopResult;
    console.log(name, commandResult);
    res.json({
      ok: commandResult.startsWith('ok') || commandResult.startsWith('kill'),
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.get('/serviceAll/:action', async (req, res) => {
  try {
    const { action } = req.params;
    const servicesList = await getAvailableServicesWithBranch();
    const items = [];

    await Promise.map(
        servicesList,
        async (service) => {
          const index = servicesList.findIndex(s => s.name === service.name);
          let generalCommand = '/usr/bin/sudo /usr/bin/sv start /etc/service/';

          if(action === 'OFF'){
            generalCommand = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/';
          }
          else if(action === 'RESTART'){
            generalCommand = '/usr/bin/sudo /usr/bin/sv -v -w 30 force-restart /etc/service/';
          }

          const commandResult = await execCmd(`${generalCommand}${service.name}`);

          items[index] = commandResult.startsWith('ok') || commandResult.startsWith('kill');
        },
        {
          concurrency: 5
        }
    );

    console.log(action, items);

    res.json({
      items
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.get('/serviceRestart/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const commandResult = await execCmd(`/usr/bin/sudo /usr/bin/sv -v -w 30 force-restart /etc/service/${name}`);
    // commandResult = exports.svRestartResult;
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

