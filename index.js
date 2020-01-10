const express = require('express');
const { exec } = require('child_process');
const Promise = require('bluebird');
const fs = require('fs');
// const mock = require('./mock');

const app = express();
const serviceExceptions = (process.env.EXCEPTIONS && process.env.EXCEPTIONS.split(',')) || [];
console.log(`Exceptions list: ${serviceExceptions.join()}`);

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
  return list
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

const getAvailableServicesWithBranch = async () => {
  let availableServices = await getAvailableServices();

  const readFileAsync = Promise.promisify(fs.readFile);
  const statAsync = Promise.promisify(fs.stat);

  const renewAvailableServices = availableServices.map((service) => {
    service.fileService = `${service.path.replace('service', 'sv')}/run`;
    return service;
  });

  for(const service of renewAvailableServices){
    let data;

    service.branch = 'unknown';

    try{
      data = await statAsync(service.fileService);
    }
    catch(e){
      continue;
    }

    let fileData = await readFileAsync(service.fileService, 'utf-8');


    const firstIndex = fileData.indexOf('/home/twiket/');

    fileData = fileData.substr(firstIndex);

    const secondIndex = fileData.indexOf('current');

    let pathLog = fileData.substr(0, secondIndex) + 'revisions.log';

    try{
      data = await statAsync(pathLog);
    }
    catch(e){
      data = undefined;
    }

    if(!data){
      try{
        pathLog = `/home/twiket/${service.name}/revisions.log`;
        data = await statAsync(pathLog);
      }
      catch(e){
        continue;
      }
    }

    fileData = await readFileAsync(pathLog, 'utf-8');

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
  }

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

app.get('/serviceOn/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const commandResult = await execCmd(`/usr/bin/sudo /usr/bin/sv start /etc/service/${name}`);
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
    const commandResult = await execCmd(`/usr/bin/sudo /usr/bin/sv -v -w 30 force-stop /etc/service/${name}`);
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

