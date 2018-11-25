const express = require('express');
const { exec } = require('child_process');
// const mock = require('./mock');

const app = express();

const execCmd = async cmd =>
  new Promise((resolve, reject) => {
    exec(cmd, (error, stdout /* , stderr */) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

const getAvailableServices = async () => {
  let list = await execCmd('sv status /etc/service/*');
  // list = mock.svStatusResult;
  list = list.split('\n');
  const services = list.map((line) => {
    if (!line) {
      return undefined;
    }
    const [status, path] = line.split(': ');
    return {
      name: path.slice(13),
      status,
    };
  }).filter(a => Boolean(a));
  return services;
};

app.use(express.static('static'));
app.set('view engine', 'pug');

app.get('/', async (req, res) => {
  try {
    const servicesList = await getAvailableServices();
    res.render('index', {
      services: servicesList,
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
    const commandResult = await execCmd(`sv start /etc/service/${name}`);
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
    const commandResult = await execCmd(`sv -v -w 59 force-stop /etc/service/${name}`);
    // commandResult =  mock.svStopResult;
    console.log(name, commandResult);
    res.json({
      ok: commandResult.startsWith('ok'),
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.get('/serviceRestart/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const commandResult = await execCmd(`sv -v -w 59 force-restart /etc/service/${name}`);
    // commandResult = exports.svRestartResult;
    console.log(name, commandResult);
    res.json({
      ok: commandResult.startsWith('ok'),
    });
  } catch (err) {
    console.log(err);
    res.json({ ok: false });
  }
});

app.listen(3000);

