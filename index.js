
const fs = require('fs');
const Client = require('ssh2').Client;

const $log = console.log.bind(console);

var sConfigPath = "~/.cappSSHForwarderServiceCreator.config.json";

var iConfigIndex = process.argv.indexOf("--config");

if (~iConfigIndex) {
  sConfigPath = process.argv[iConfigIndex+1];

  if (!fs.existsSync(sConfigPath)) {
    throw new Error(`Config not found '${sConfigPath}'`);
  }
}

$log(`Use config file: '${sConfigPath}'`);

if (!fs.existsSync(sConfigPath)) {
  sConfigPath = "./config.json";
  $log(`Use config file: '${sConfigPath}'`);
}

if (!fs.existsSync(sConfigPath)) {
  throw new Error(`Config not found '${sConfigPath}'`);
}

$log(`Read: '${sConfigPath}'`);

var oConfig = JSON.parse(fs.readFileSync(sConfigPath).toString());

function fnReadKey(sKeyPath)
{
  if (sKeyPath.trim()) {
    if (!fs.existsSync(sKeyPath)) {
      $log(`Key not found: '${sKeyPath}'`);
    }

    return fs.readFileSync(sKeyPath);
  }
}

function fnExec(oConnection, sCommand)
{
  oConnection
    .exec(sCommand, (err, stream) => {
      if (err) 
        throw err;
      stream
        .on('close', (code, signal) => {
          console.log('Stream :: close :: code: ' + code + ', signal: ' + signal);
          oConnection.end();
        })
        .on('data', (data) => {
          console.log('STDOUT: ' + data);
        })
        .stderr
        .on('data', (data) => {
          console.log('STDERR: ' + data);
        });
    });
}

function fnDefault(mValue, mDefaultValue)
{
  return mValue ? mValue : mDefaultValue;
}

// ssh -vvv -D 0.0.0.0:9090 -f -F ../.ssh/config -o StrictHostKeyChecking=no -C -N proxy_fornex
// -L \${LOCAL_ADDR}:\${LOCAL_PORT}:localhost:\${REMOTE_PORT}

/**
 * ssh -D opens a local port, but it doesn't have 
 * a specific endpoint like with -L. Instead, it 
 * pretends to be a SOCKS proxy. If you open, e.g., 
 * ssh -D 7777, when you tell your browser to 
 * use localhost:7777 as your SOCKS proxy, 
 * everything your browser requests goes through 
 * the ssh tunnel. To the public internet, it's 
 * as if you were browsing from your ssh server 
 * instead of from your computer.
 */

var sUnitFilePath = '/etc/systemd/system/secure-tunnel@.service';
var sUnitFileTemplate = `
[Unit]
Description=Setup a secure tunnel to %I
After=network.target

[Service]
Environment="LOCAL_ADDR=localhost"
EnvironmentFile=/etc/default/secure-tunnel@%i
ExecStart=/usr/bin/ssh -NT -C -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -D \${LOCAL_ADDR}:\${LOCAL_PORT} \${TARGET}

# Restart every >2 seconds to avoid StartLimitInterval failure
RestartSec=5
Restart=always

[Install]
WantedBy=multi-user.target
`;

var sUnitFileConfigPathTemplate = '/etc/default/secure-tunnel@{UNIT_NAME}';
var sUnitFileConfigTemplate = `
TARGET={TARGET}
LOCAL_ADDR={LOCAL_ADDR}
LOCAL_PORT={LOCAL_PORT}
`;

for (var sServerName in oConfig) {
  var oConnection = new Client();

  oConnection
    .on('ready', () => {
      console.log('Client :: ready');

      var sServiceName = fnDefault(oConfig[sServerName].sUnitServiceName, "proxy");

      var sUnitFileConfigPath = sUnitFileConfigPathTemplate
        .replace('{UNIT_NAME}', sServiceName);
      
      var sUnitFileConfig = sUnitFileConfigTemplate
        .replace('{TARGET}', oConfig[sServerName].sSSHConfigTarget)
        .replace('{LOCAL_ADDR}', fnDefault(oConfig[sServerName].sLocalAddress, "0.0.0.0"))
        .replace('{LOCAL_PORT}', fnDefault(oConfig[sServerName].sLocalPort, "9090"));

      fnExec(oConnection, `sudo cat <<EOF > ${sUnitFileConfigPath} ${sUnitFileConfig}`);
      fnExec(oConnection, `sudo cat <<EOF > ${sUnitFilePath} ${sUnitFileTemplate}`);

      fnExec(oConnection, `systemctl daemon-reload`);
      fnExec(oConnection, `systemctl start secure-tunnel@${sServiceName}`);
      fnExec(oConnection, `systemctl status secure-tunnel@${sServiceName}`);
      fnExec(oConnection, `systemctl enable secure-tunnel@${sServiceName}`);
    })
    .connect({
      host: oConfig[sServerName].sHost,
      port: oConfig[sServerName].iPort,
      username: oConfig[sServerName].sUserName,
      privateKey: fnReadKey(oConfig[sServerName].sPrivateKeyPath)
    });
}

