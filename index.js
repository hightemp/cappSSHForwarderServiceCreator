
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

async function fnExec(oConnection, sCommand, sStreamWriteText='')
{
  $log('Exec: ' + sCommand);

  return (new Promise((fnSuccess, fnFail) => {
    oConnection
      .exec(sCommand, { pty: true }, (err, stream) => {
        if (err) {
          throw err;
        }

        $log('Exececuted');

        function fnStreamWriteText()
        {
          if (sStreamWriteText) {
            $log(`stream.write: ${sStreamWriteText}`);
            stream.write(`${sStreamWriteText}\n`);
          }
        }

        fnStreamWriteText();

        stream
          .on('exit', function() {
            $log('Stream :: exit');
          })
          .on('end', function() {
            $log('Stream :: end');
          })
          .on('error', function(err) {
            $log('Stream :: error: ' + err);
          })
          .on('close', (code, signal) => {
            $log('Stream :: close :: code: ' + code + ', signal: ' + signal);
            // oConnection.end();
            fnSuccess();
          })
          .on('data', (data) => {
            $log('Stream :: stdout :: data: ' + data);
            fnSuccess(data);
          })
          .stderr
          .on('data', (data) => {
            $log('Stream :: stderr :: data: ' + data);
            fnFail(data);
          });
      });
  }));
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
ExecStart=/usr/bin/ssh -vvv -NT -C -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -D \${LOCAL_ADDR}:\${LOCAL_PORT} \${TARGET}

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
  (async (sServerName, oConfigItem) => {
    var oConnection = new Client();

    oConnection
      .on('error', function(err) {
        $log('Connection :: error :: ' + err);
      })
      .on('end', function() {
        $log('Connection :: end');
      })
      .on('close', function(had_error) {
        $log('Connection :: close', had_error ? 'had error' : '');
      })
      .on('ready', async () => {
        $log('Client :: ready');

        var sServiceName = fnDefault(oConfigItem.sUnitServiceName, "proxy");

        var sUnitFileConfigPath = sUnitFileConfigPathTemplate
          .replace('{UNIT_NAME}', sServiceName);
        
        var sUnitFileConfig = sUnitFileConfigTemplate
          .replace('{TARGET}', oConfigItem.sSSHConfigTarget)
          .replace('{LOCAL_ADDR}', fnDefault(oConfigItem.sLocalAddress, "0.0.0.0"))
          .replace('{LOCAL_PORT}', fnDefault(oConfigItem.sLocalPort, "9090"));

        try {
          // var sSudo = `echo "${oConfigItem.sSudoPassword}" | sudo -S`;

          await fnExec(oConnection, `sudo su`, 
`${oConfigItem.sSudoPassword}
whoami
cat <<EOF > ${sUnitFileConfigPath} ${sUnitFileConfig}\nEOF
cat <<EOF > ${sUnitFilePath} ${sUnitFileTemplate}\nEOF
systemctl daemon-reload
systemctl start secure-tunnel@${sServiceName}
systemctl enable secure-tunnel@${sServiceName}
exit
`);
          
          $log("************ EXIT ************");

          oConnection.end();
        } catch (oError) {
          $log("Error:"+oError+"");
        }
      })
      .connect({
        host: oConfigItem.sHost,
        port: oConfigItem.iPort,
        username: oConfigItem.sUserName,
        privateKey: fnReadKey(oConfigItem.sPrivateKeyPath)
      });
  })(sServerName, oConfig[sServerName]);
}

