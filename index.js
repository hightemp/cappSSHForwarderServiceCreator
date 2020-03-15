
const fs = require('fs');
const path = require('path');
const Client = require('ssh2').Client;

const $log = console.log.bind(console);
const $err = console.error.bind(console);
const $dir = console.dir.bind(console);

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
            fnSuccess();
          })
          .on('end', function() {
            $log('Stream :: end');
            fnSuccess();
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
            $log('Stream :: stdout :: data:');
            $dir(data.toString());
            // fnSuccess(data);
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

/**
 * -f      Requests ssh to go to background just before command execution.  This is useful if ssh is going to ask for
             passwords or passphrases, but the user wants it in the background.  This implies -n.  The recommended way to
             start X11 programs at a remote site is with something like ssh -f host xterm.

             If the ExitOnForwardFailure configuration option is set to “yes”, then a client started with -f will wait for
             all remote port forwards to be successfully established before placing itself in the background.
 * -F configfile
             Specifies an alternative per-user configuration file.  If a configuration file is given on the command line,
             the system-wide configuration file (/etc/ssh/ssh_config) will be ignored.  The default for the per-user config‐
             uration file is ~/.ssh/config.
 * -D [bind_address:]port
             Specifies a local “dynamic” application-level port forwarding.  This works by allocating a socket to listen to
             port on the local side, optionally bound to the specified bind_address.  Whenever a connection is made to this
             port, the connection is forwarded over the secure channel, and the application protocol is then used to deter‐
             mine where to connect to from the remote machine.  Currently the SOCKS4 and SOCKS5 protocols are supported, and
             ssh will act as a SOCKS server.  Only root can forward privileged ports.  Dynamic port forwardings can also be
             specified in the configuration file.

             IPv6 addresses can be specified by enclosing the address in square brackets.  Only the superuser can forward
             privileged ports.  By default, the local port is bound in accordance with the GatewayPorts setting.  However,
             an explicit bind_address may be used to bind the connection to a specific address.  The bind_address of
             “localhost” indicates that the listening port be bound for local use only, while an empty address or ‘*’ indi‐
             cates that the port should be available from all interfaces.
 * -N      Do not execute a remote command.  This is useful for just forwarding ports.
 * -T      Disable pseudo-terminal allocation.
 * -C      Requests compression of all data (including stdin, stdout, stderr, and data for forwarded X11, TCP and
             UNIX-domain connections).  The compression algorithm is the same used by gzip(1).  Compression is desirable on
             modem lines and other slow connections, but will only slow down things on fast networks.  The default value can
             be set on a host-by-host basis in the configuration files; see the Compression option.
 */

var sUnitFilePath = '/etc/systemd/system/secure-tunnel@.service';
var sUnitFileTemplate = `
[Unit]
Description=Setup a secure tunnel to %I
After=network.target

[Service]
Environment="LOCAL_ADDR=localhost"
EnvironmentFile=/etc/default/secure-tunnel@%i
ExecStart=/usr/bin/ssh -vvv -F /root/.ssh/config -o StrictHostKeyChecking=no -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -D \\\${LOCAL_ADDR}:\\\${LOCAL_PORT} -NT -C \\\${TARGET}

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

/**
 * .ssh directory: 700 (drwx------)
 * public key (.pub file): 644 (-rw-r--r--)
 * private key (id_rsa): 600 (-rw-------)
 * lastly your home directory should not be writeable by the group or others (at most 755 (drwxr-xr-x)).
 */

          if (!oConfigItem.sSSHConfigPath) {
            throw `sSSHConfigPath not defined for '${sServerName}'`;
          }
          if (!oConfigItem.sSSHKeyPath) {
            throw `sSSHKeyPath not defined for '${sServerName}'`;
          }

          var sConfigFileContent = fs.readFileSync(oConfigItem.sSSHConfigPath).toString();
          var sConfigFileName = path.basename(oConfigItem.sSSHConfigPath);
          var sKeyFileContent = fs.readFileSync(oConfigItem.sSSHKeyPath).toString();
          var sKeyFileName = path.basename(oConfigItem.sSSHKeyPath);

          if (!sConfigFileContent.trim()) {
            throw `sConfigFileContent is empty'`;
          }
          if (!sKeyFileContent.trim()) {
            throw `sKeyFileContent is empty`;
          }

          await fnExec(oConnection, `sudo su`, 
`${oConfigItem.sSudoPassword}
whoami
cat <<EOF > /root/.ssh/${sConfigFileName}\n${sConfigFileContent}\nEOF
cat <<EOF > /root/.ssh/${sKeyFileName}\n${sKeyFileContent}\nEOF
chmod 700 /root/.ssh
chmod 600 /root/.ssh/${sKeyFileName}
cat <<EOF > ${sUnitFileConfigPath}\n${sUnitFileConfig}\nEOF
cat <<EOF > ${sUnitFilePath}\n${sUnitFileTemplate}\nEOF
systemctl daemon-reload
systemctl restart secure-tunnel@${sServiceName}
systemctl enable secure-tunnel@${sServiceName}
exit
`);
          
          $log("************ EXIT ************");

          $log(`CHECK status:`);
          $log(`1. sudo systemctl status secure-tunnel@${sServiceName}`);
          $log(`2. sudo journalctl -u secure-tunnel@${sServiceName}`);

          $log("******************************");

          oConnection.end();
        } catch (oError) {
          $log("Error: "+oError+"");
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

