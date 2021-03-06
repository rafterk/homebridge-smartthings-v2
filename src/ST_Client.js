const {
    platformName,
    platformDesc,
    pluginVersion
} = require("./libs/Constants"),
    rp = require("request-promise-native"),
    url = require("url");

module.exports = class ST_Client {
    constructor(platform) {
        this.platform = platform;
        this.log = platform.log;
        this.useLocal = platform.local_commands;
        this.hubIp = platform.local_hub_ip;
        this.configItems = platform.getConfigItems();
        let appURL = url.parse(this.configItems.app_url);
        this.urlItems = {
            app_host: appURL.hostname || "graph.api.smartthings.com",
            app_port: appURL.port || 443,
            app_path: `${(appURL.path || "/api/smartapps/installations/")}${this.configItems.app_id}/`
        };
        this.localErrCnt = 0;
        this.localDisabled = false;
    }

    sendAsLocalCmd() {
        return (this.useLocal === true && this.hubIp !== undefined);
    }

    localHubErr(hasErr) {
        if (hasErr) {
            if (this.useLocal && !this.localDisabled) {
                this.log.error(`Unable to reach your SmartThing Hub Locally... You will not receive device events!!!`);
                this.useLocal = false;
                this.localDisabled = true;
            }
        } else {
            if (this.localDisabled) {
                this.useLocal = true;
                this.localDisabled = false;
                this.log.good(`Now able to reach local Hub... Restoring Local Commands!!!`);
                this.sendStartDirect();
            }
        }
    }

    updateGlobals(hubIp, useLocal = false) {
        this.log.notice(`Updating Global Values | HubIP: ${hubIp} | UseLocal: ${useLocal}`);
        this.hubIp = hubIp;
        this.useLocal = (useLocal === true);
    }

    getDevices() {
        let that = this;
        return new Promise((resolve) => {
            rp({
                    uri: `${that.configItems.app_url}${that.configItems.app_id}/devices`,
                    qs: {
                        access_token: that.configItems.access_token
                    },
                    json: true
                })
                .catch((err) => {
                    that.log.error("getDevices Error: ", err.message);
                    that.platform.Sentry.captureException(err);
                    resolve(undefined);
                })
                .then((body) => {
                    resolve(body);
                });
        });
    }

    getDevice(deviceid) {
        let that = this;
        return new Promise((resolve) => {
            rp({
                    uri: `${that.configItems.app_url}${that.configItems.app_id}/${deviceid}/query`,
                    qs: {
                        access_token: that.configItems.access_token
                    },
                    json: true
                })
                .catch((err) => {
                    that.log.error("getDevice Error: ", err.message);
                    that.platform.Sentry.captureException(err);
                    resolve(undefined);
                })
                .then((body) => {
                    resolve(body);
                });
        });
    }

    sendDeviceCommand(callback, devData, cmd, vals) {
        let that = this;
        let sendLocal = this.sendAsLocalCmd();
        let config = {
            method: 'POST',
            uri: `${this.configItems.app_url}${this.configItems.app_id}/${devData.deviceid}/command/${cmd}`,
            qs: {
                access_token: this.configItems.access_token
            },
            headers: {
                evtSource: `Homebridge_${platformName}_${this.configItems.app_id}`,
                evtType: 'hkCommand'
            },
            body: vals,
            json: true
        };
        if (sendLocal) {
            config.uri = `http://${this.hubIp}:39500/event`;
            delete config.qs;
            config.body = {
                deviceid: devData.deviceid,
                command: cmd,
                values: vals
            };
        }
        return new Promise((resolve, reject) => {
            that.log.notice(`Sending Device Command: ${cmd}${vals ? ' | Value: ' + JSON.stringify(vals) : ''} | Name: (${devData.name}) | DeviceID: (${devData.deviceid}) | SendToLocalHub: (${sendLocal})`);
            try {
                rp(config)
                    .catch((err) => {
                        that.log.error('sendDeviceCommand Error:', err.message);
                        if (callback) {
                            callback();
                            callback = undefined;
                        };
                        if (err.message.startsWith('Error: connect ETIMEDOUT ')) {
                            that.localHubErr(true);
                        }
                        that.platform.Sentry.captureException(err);
                        // reject(err);
                    })
                    .then((body) => {
                        this.log.debug(`sendDeviceCommand Resp: ${JSON.stringify(body)}`);
                        if (callback) {
                            callback();
                            callback = undefined;
                        }
                        that.localHubErr(false);
                        resolve(body);
                    });
            } catch (err) {
                reject(err);
            }
        });
    }

    sendUpdateStatus(hasUpdate, newVersion = null) {
        return new Promise((resolve, reject) => {
            this.log.notice(`Sending Plugin Status to SmartThings | UpdateAvailable: ${hasUpdate}${newVersion ?  ' | newVersion: ' + newVersion : ''}`);
            rp({
                    method: 'POST',
                    uri: `${this.configItems.app_url}${this.configItems.app_id}/pluginStatus`,
                    qs: {
                        access_token: this.configItems.access_token
                    },
                    body: { hasUpdate: hasUpdate, newVersion: newVersion, version: pluginVersion },
                    json: true
                })
                .catch((err) => {
                    this.log.error('sendUpdateStatus Error:', err.message);
                    this.platform.Sentry.captureException(err);
                    reject(undefined);
                })
                .then((body) => {
                    // console.log(body);
                    if (body) {
                        this.log.debug(`sendUpdateStatus Resp: ${JSON.stringify(body)}`);
                        resolve(body);
                    } else { resolve(null); }
                });
        });
    }

    sendStartDirect() {
        let that = this;
        let sendLocal = this.sendAsLocalCmd();
        let config = {
            method: 'POST',
            uri: `${this.configItems.app_url}${this.configItems.app_id}/startDirect/${this.configItems.direct_ip}/${this.configItems.direct_port}/${pluginVersion}`,
            qs: {
                access_token: this.configItems.access_token
            },
            headers: {
                evtSource: `Homebridge_${platformName}_${this.configItems.app_id}`,
                evtType: 'enableDirect'
            },
            body: {
                ip: that.configItems.direct_ip,
                port: that.configItems.direct_port,
                version: pluginVersion
            },
            json: true
        };
        if (sendLocal) {
            config.uri = `http://${this.hubIp}:39500/event`;
            delete config.qs;
        }
        return new Promise((resolve, reject) => {
            that.log.info(`Sending StartDirect Request to ${platformDesc} | SendToLocalHub: (${sendLocal})`);
            try {
                rp(config)
                    .catch((err) => {
                        that.log.error("sendStartDirect Error: ", err.message);
                        if (err.message.startsWith('Error: connect ETIMEDOUT ')) {
                            that.localHubErr(true);
                        }
                        // reject(err);
                        that.platform.Sentry.captureException(err);
                    })
                    .then((body) => {
                        // that.log.info('sendStartDirect Resp:', body);
                        if (body) {
                            this.log.debug(`sendStartDirect Resp: ${JSON.stringify(body)}`);
                            resolve(body);
                            that.localHubErr(false);
                        } else { resolve(null); }
                    });
            } catch (err) {
                reject(err);
            }
        });
    }
};