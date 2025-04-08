
/**  Copyright (c) 2024, Manuel Lõhmus (MIT License). */

'use strict';

var configSets = require("config-sets"),
    { createHttpServer, createHttpsServer, availableLinks } = require('./server'),
    os = require('node:os'),
    cluster = require('node:cluster'),

    clusterOptions = configSets('web-cluster', {
        isDebug: false,
        parallelism: 'auto',
    });

module.exports = WebCluster;

return;


/**
 * @typedef {Object} WebCluster
 * @property {Options} clusterOptions
 * @property {Options} serverOptions
 * @property {http} serverHttpToHttps
 * @property {[fork]} workers
 */

/**
 * Runs the web server in cluster mode
 * @param {Options} options
 * @param {(server:http)=>void} _initServer
 * @returns {WebCluster}
 */
function WebCluster(
    options = {},
    _initServer = function (server) { /* Initialize */ }
) {

    var serverOptions = configSets('tiny-https-server', {}),
        isSSL = false,
        webCluster = Object.create(null, {
            isSSL: { get: function () { return isSSL; }, configurable: false, enumerable: false },
            clusterOptions: { get: function () { return clusterOptions; }, configurable: false, enumerable: false },
            serverOptions: { get: function () { return serverOptions; }, configurable: false, enumerable: false },
            serverHttpToHttps: { value: null, writable: true, configurable: false, enumerable: false },
            web_workers: { get: function () { return web_workers; }, configurable: false, enumerable: false },
            availableLinks: { value: availableLinks, writable: false, configurable: false, enumerable: false },
        }),
        web_workers = [];

    if (options.isDebug) { clusterOptions.isDebug = options.isDebug; serverOptions.isDebug = options.isDebug; }
    delete options.isDebug;
    if (options.parallelism) { clusterOptions.parallelism = options.parallelism; }
    delete options.parallelism;
    serverOptions = configSets.assign(serverOptions, options, true);

    isSSL = (serverOptions.port === 80) ? false
        : Boolean(serverOptions.key && serverOptions.cert || serverOptions.port === 443);


    if (cluster.isPrimary) {

        setImmediate(initWorkers);

        cluster.on('fork', (worker) => {

            pDebug(`workerType '${worker.workerType}' started.`);

            var length = Object.keys(cluster.workers).length;

            pDebug("workers.count", length);
        });

        cluster.on('exit', (worker, code, signal) => {

            pDebug(`workerType '${worker.workerType}' died (`, signal || code, `).`);

            var length = Object.keys(cluster.workers).length;

            pDebug("workers.count", length);

            if (!length) { initWorkers(); }
        });

        return webCluster;


        function initWorkers() {

            var parallelism = isNaN(parseInt(clusterOptions.parallelism)) ? clusterOptions.parallelism : parseInt(clusterOptions.parallelism),
                max_parallelism = os.availableParallelism?.() || os.cpus().length,
                workersCount = 0;

            //create http to https
            if (isSSL) { webCluster.serverHttpToHttps = createHttp(true); }

            // parallelism is a valid number
            if (typeof parallelism === 'number' && (0 < parallelism && parallelism < max_parallelism)) {

                if (parallelism > 1) { serverOptions.exclusive = false; }

                for (var i = 0; i < parallelism; i++) {

                    webCluster.web_workers.push(createWorker());
                }
            }
            // parallelism is not a valid number
            else if (typeof parallelism === 'number') {

                serverOptions.exclusive = false;

                for (var i = 0; i < max_parallelism; i++) {

                    webCluster.web_workers.push(createWorker());
                }
            }
            // parallelism is string 'auto' | 'auto 1'| 'auto 2' ...
            else {

                serverOptions.exclusive = false;

                var [auto, start_parallelism] = (parallelism + '').split(/\s+/);

                start_parallelism = parseInt(start_parallelism);

                // start_parallelism is number
                if (!isNaN(start_parallelism)) {

                    if (start_parallelism > max_parallelism) { start_parallelism = max_parallelism; }

                    for (var i = 0; i < start_parallelism; i++) {

                        webCluster.web_workers.push(createWorker('auto'));
                    }
                }
                // start_parallelism is not a number, creates core count workers
                else {

                    for (var i = 0; i < max_parallelism / 2; i++) {

                        webCluster.web_workers.push(createWorker('auto'));
                    }
                }
            }

            return;


            function createWorker(workerType = '') {

                switch (workerType) {

                    case 'auto': return createWorker(true);

                    case 'autoscaling': return createAutoScalingWorker();

                    default: return createWorker();
                }

                return;


                function createWorker(auto = false) {

                    workersCount++;

                    var worker = cluster.fork({ workerType, exclusive: serverOptions.exclusive });
                    worker.workerType = workerType;

                    //pDebug(`Web Worker ${auto ? '(Auto Scaling up) ' : ''}starts:`, worker.id);
                    //pDebug("Start: Web Worker Count:", workersCount);

                    worker.on('exit', (code) => {

                        workersCount--;

                        if (code) {

                            //pDebug(`Web Worker ${auto ? '(Auto Scaling up) ' : ''}exit:`, worker.id);
                            //pDebug("Error: Web Worker Count:", workersCount);

                            createWorker(workerType);
                        }
                    });

                    worker.on('message', function (msg) {

                        if (auto && msg.cmd === 'autoscaling') {

                            createAutoScalingWorker();
                        }
                    });

                    return worker;
                }

                function createAutoScalingWorker() {

                    if (workersCount < max_parallelism) {

                        workersCount++;

                        var worker = cluster.fork({ workerType: 'autoscaling', exclusive: serverOptions.exclusive });
                        worker.workerType = 'autoscaling';

                        //pDebug("Scaled up: Web Worker starts:", worker.id);
                        //pDebug("Scaled up: Web Worker Count:", workersCount);

                        worker.on('exit', () => {

                            workersCount--;

                            //pDebug("Scaled down: Web Worker exit:", worker.id);
                            //pDebug("Scaled down: Web Worker Count:", workersCount);
                        });

                        worker.on('message', function (msg) {

                            if (msg.cmd && msg.cmd === 'autoscaling') {

                                createAutoScalingWorker();
                            }
                        });

                        return worker;
                    }
                }
            }

            function createHttp(isHttpToHttps = false) {

                if (isHttpToHttps) { pDebug("Http -> Https Server starts."); }

                else { pDebug("Http Server starts."); }

                var httpServer = createHttpServer(serverOptions, isHttpToHttps);

                return httpServer;
            }
        }
    }

    else if (cluster.isWorker) {

        var workerType = process.env.workerType;
        serverOptions.exclusive = process.env.exclusive === 'true';

        switch (workerType) {

            case 'auto': return createServer();

            case 'autoscaling': return createServer(true);

            default: return createServer();
        }

        return process;


        function createServer(isAutoExit = false) {

            var options = configSets.assign({}, serverOptions, true);

            var server = isSSL
                ? createHttpsServer(options)
                : createHttpServer(options);

            if (isAutoExit) { server.isAutoExit = true; }

            server.on("autoscaling", function () {

                process.send({ cmd: 'autoscaling' });
            });

            _initServer.call(webCluster, server);

            return server;
        }
    }

    else { pError('Something went wrong.'); }

    return webCluster;
}

// Debugging
function pDebug(msg) { if (clusterOptions.isDebug) { console.log(`[ DEBUG ] 'web-cluster' `, ...arguments); } }
function pError(msg) { if (clusterOptions.isDebug) { console.error(`[ ERROR ] 'web-cluster' `, ...arguments); } }