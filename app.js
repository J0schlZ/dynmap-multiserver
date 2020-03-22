"use strict";

const FS        = require('fs');
const Path      = require('path');
const Express   = require('express');
const Request   = require('request-promise');
const MimeTypes = require('mime-types');

const version = '1.0.0-SNAPSHOT';

const config = {
    checkInterval   : 10, // 1 Sek
    crossOrigin     : false,
    configServer    : 'lobby',
    mapServer : {
        'lobby' : {
            url : 'https://map.craft-together.de/lobby',
            files : '/var/www/vhosts/craft-together.de/subdomains/map/lobby'
        },
        'freebuild1' : {
            url : 'https://map.craft-together.de/freebuild1',
            files : '/var/www/vhosts/craft-together.de/subdomains/map/freebuild1'
        },
        'freebuild2' : {
            url : 'https://map.craft-together.de/freebuild2',
            files : '/var/www/vhosts/craft-together.de/subdomains/map/freebuild2'
        },
        'dev' : {
            url : 'https://map.craft-together.de/dev',
            files : '/var/www/vhosts/craft-together.de/subdomains/map/dev'
        }
    }
};

class DynmapMultiserver {
    constructor(config) {
        this.app = Express();
        this.config = config;

        this.dynmap = {
            configScript    : null,
            server          : {},
            maps            : {},
            markers         : {},
            worlds          : {},
            players         : {}
        };

        this.app.use('/', Express.static('./public'));
        this.app.get('/standalone/*', (req, res) => this.standalone(req, res));
        this.app.get('/tiles/*', (req, res) => this.tiles(req, res));

        this.getConfiguration(config.configServer).then(() => {
            setInterval(() => {
                this.getServerConfig();
            }, this.config.checkInterval * 1000);

            this.app.listen(8123, function () {
                console.log('dynmap-multiserver v' + version + ' started.');
            });
        });
    }

    async getConfiguration(configServer) {
        this.dynmap.configScript = await this.getConfigScript(configServer);
        this.getServerConfig();
    }

    tiles(req, res) {
        if (req.originalUrl.startsWith('/tiles/_markers_')) {
            let match = /marker_([A-Z_0-9-]{0,}).json/gi.exec(req.params[0]);

            if (match) {
                let worldName = match[1];

                if (typeof (this.dynmap.markers[worldName]) === 'object')
                    res.json(this.dynmap.markers[worldName]);
                else {
                    console.log(req.path);
                    res.sendStatus(404);
                }
            }
            else {
                let file = "./markers/" + Path.basename(req.params[0]);

                if (FS.existsSync(file)) {
                    let mimeType = MimeTypes.lookup(file);

                    if (mimeType) {
                        FS.readFile(file, (err, data) => {
                            if (err)
                                throw err;

                            res.writeHead(302, {
                                'Content-Type': mimeType
                            });
                            res.end(data);
                        });
                    }
                }
                else
                    res.sendStatus(404);
            }
        }

        else if (req.originalUrl.startsWith('/tiles/faces')) {
            let match = /\/tiles\/faces\/([A-Z-_0-9]\w+)\/([A-Z-_0-9]{0,16}).([A-Z0-9]\w+)/gi.exec(req.originalUrl);

            if (match) {
                let size = match[1], playerName = match[2], location;

                if (size === 'body')
                    location = 'https://ctma.craft-together.de/api/skin/' + playerName + '/surgeplay/bust/32';
                else
                    location = 'https://ctma.craft-together.de/api/skin/' + playerName + '/surgeplay/head/16';

                res.writeHead(302, {
                    'Location': location
                });
                res.end();

                return;
            }

            req.sendStatus(404);
        }

        else {
            let match = /tiles\/([A-Z_0-9-]{0,})\//gi.exec(req.originalUrl);

            if (match) {
                let worldName = match[1], serverName = null;

                if (typeof (this.dynmap.worlds[worldName]) === 'object')
                    serverName = this.dynmap.worlds[worldName].server;

                let location = this.config.mapServer[serverName].url + '/' + req.path.substring(1);

                res.writeHead(302, {
                    'Location': location
                });

                res.end();
                return;
            }

            console.log('Not handled: ' + req.originalUrl);
            res.sendStatus(404);
        }
    }

    standalone(req, res) {
        if (req.params[0].startsWith('dynmap_') && req.params[0] !== 'dynmap_config.json') {
            let match = /dynmap_([A-Z_0-9-]{0,}).json/gi.exec(req.params[0]);

            if (match) {
                let worldInfo = this.dynmap.maps[match[1]] || {};
                worldInfo.players = this.dynmap.players;
                worldInfo.currentcount = Object.keys(this.dynmap.players).length;
                res.json(worldInfo);
                return;
            }
        }

        switch (req.params[0]) {
            default:
                console.log(req.originalUrl);
                res.sendStatus(404);
                break;

            case "config.js":
                if (this.dynmap.configScript === null || this.dynmap.configScript === {}
                    ||  this.dynmap.server[config.configServer] == null || this.dynmap.server[config.configServer] === {})
                    res.end('alert(\'MultiMap v' + version + ' is not ready. Please try again later.\');');
                else
                    res.end(this.dynmap.configScript);
                break;

            case "dynmap_config.json":
                let dynmapConfig = {};

                if (typeof (this.dynmap.server[config.configServer]) === 'object')
                    dynmapConfig = this.dynmap.server[config.configServer].config || {};

                dynmapConfig.worlds = this.dynmap.worlds;

                res.json(dynmapConfig);
                break;

            case "playerlist":
                res.json(this.dynmap.players);
                break;

            case "worldlist":
                res.json(this.dynmap.worlds);
                break;

            case "serverlist":
                res.json(this.dynmap.worlds);
                break;
        }
    }

    async getJSONFile(url) {
        let content, response = null;

        try {
            response = await Request(url);
            content = JSON.parse(response);
        } catch (err) {
            console.log(err.stack);
            return {};
        }

        return content;
    }

    async getConfigScript(serverName) {
        let configScript = null;

        try {
            if (typeof (this.config.mapServer[serverName].files) === 'string' && FS.existsSync(this.config.mapServer[serverName].files))
                configScript = (await FS.promises.readFile(this.config.mapServer[serverName].files + '/standalone/config.js')).toString();
            else
                configScript = await Request(this.config.mapServer[serverName].url + '/standalone/config.js');
        } catch (err) {
            console.log(err.stack);
        }

        /*let config = {},
            lines  = response.replace(/\r\n/g, '\n').split('\n');

        for (let i in lines) {
            let match = /([a-z_]{1,}):\s'(.*)',?/gi.exec(lines[i]);
            if (!match) continue;
            config[match[1]] = match[2];
        }*/
        //response = response.replace(/standalone\/dynmap_config.json/gi, '{server}/standalone/dynmap_config.json');
        //response = response.replace(/standalone\/dynmap_{world}.json/gi, '{server}/standalone/dynmap_{world}.json');

        return configScript;
    }

    async getServerConfig(serverName = null) {
        if (serverName !== null) {
            let config;

            try {
                if (typeof (this.config.mapServer[serverName].files) === 'string' && FS.existsSync(this.config.mapServer[serverName].files)) {
                    let cfgJson = await FS.promises.readFile(this.config.mapServer[serverName].files + '/standalone/dynmap_config.json');
                    config = JSON.parse(cfgJson.toString());
                } else
                    config = await this.getJSONFile(this.config.mapServer[serverName].url + '/standalone/dynmap_config.json');
            }
            catch (err) {
                console.log(err);
                return null;
            }

            config.servername = serverName;

            let server = {
                config  : config,
                maps    : {},
                markers : {},
                worlds  : {},
                players : {}
            };

            for (let i1 in config.worlds) {
                let world = config.worlds[i1];
                world.server = serverName;

                this.dynmap.worlds[world.name] = world;
                server.worlds[world.name] = world;

                let map, markers;

                if (typeof (this.config.mapServer[serverName].files) === 'string' && FS.existsSync(this.config.mapServer[serverName].files)) {
                    try {
                        let mapJson = await FS.promises.readFile(this.config.mapServer[serverName].files + '/standalone/dynmap_' + world.name + '.json');
                        map = JSON.parse(mapJson.toString());
                        let markersJson = await FS.promises.readFile(this.config.mapServer[serverName].files + '/tiles/_markers_/marker_' + world.name + '.json');
                        markers = JSON.parse(markersJson.toString());
                    }
                    catch (err) {
                        console.log(err);
                        return null;
                    }
                }
                else {
                    map = await this.getJSONFile(this.config.mapServer[serverName].url + '/standalone/dynmap_' + world.name + '.json');
                    markers = await this.getJSONFile(this.config.mapServer[serverName].url + '/tiles/_markers_/marker_' + world.name + '.json');
                }

                map.server = serverName;

                this.dynmap.maps[world.name] = map;
                server.maps[world.name] = map;

                this.dynmap.markers[world.name] = markers;
                server.markers[world.name] = markers;

                for (let i2 in map.players) {
                    let player = map.players[i2];
                    player.server = serverName;

                    this.dynmap.players[player.account] = player;
                    server.players[player.account] = player;
                }
            }

            this.dynmap.server[serverName] = server;
            return server;
        }
        else {
            let server = {};

            for (let serverName in this.config.mapServer)
                server[serverName] = await this.getServerConfig(serverName);

            return server;
        }
    }
}

if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString) {
        return (haystack.lastIndexOf(searchString, 0) === 0);
    };
}

new DynmapMultiserver(config);