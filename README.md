# tiny-https-server: Easy tiny https web server middleware.

[![npm-version](https://badgen.net/npm/v/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![npm-total-downloads](https://badgen.net/npm/dt/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![npm-week-downloads](https://badgen.net/npm/dw/tiny-https-server)](https://www.npmjs.com/package/tiny-https-server)
[![](https://data.jsdelivr.com/v1/package/npm/tiny-https-server/badge)](https://www.jsdelivr.com/package/npm/tiny-https-server)

Easy tiny https web server middleware.
Easy to use and configure.
Handle subdomains.
Serving static files.

## Installing

`npm install tiny-https-server`

## Usage example

app.js
```js
require('log-report');

if (require("try-to-run")()) {
    // isMainThread
    return;
}

console.time("Time");
var options = require("config-sets").tiny_https_server;
options.subdomains = { test: "./public/test" };

var server = require("tiny-https-server");
//var server = require("./server.min.js");

// Console log
server.on("request", function (req, res, next) {
    console.timeLog("Time", `Url: ${req.headers.host}${req.url}`);
    next();
});
// Test page.
server.on("request", function (req, res, next) {
    if (req.url === "/test") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("Test page.");
        res.end();
    }
    else
        next();
});
// Simulated crash ...
server.on("request", function (req, res, next) {
    if (req.url === "/crash") {
        throw new Error("Simulated crash ...");
    }
    else
        next();
});


var port = options.port === 443 ? "" : ":" + options.port;
var urls = [
    `http://localhost${port}/`,
    `http://test.localhost${port}/`,
    `http://localhost${port}/test`,
    `http://test.localhost${port}/test`,
    `http://localhost${port}/home`
];

// Opens the URLs in the default browser.
while (urls.length) {
    require("browse-url")(urls.shift());
}
```

## Service Worker example

Read more about the ['Service Worker API'](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)\
Set the current 'service_worker_version' in the config-sets.json file.
```json
{
  "production": {
    "tiny_https_server": {
      "service_worker_version": "1.0.0",
      "content_delivery_network_url": "",       /***** "" | "https://cdn.jsdelivr.net/npm/" *****/
      "content_delivery_network_root": "",      /***** "" | "npm_name/www" *****/
      "precache_urls": null                     /***** null | [] | ["/index.html, ..."] *****/
    }
  }
}
```

Add to the webpage [Service Worker Script](browser.js)
```html
<!doctype html>
<html>
<head>
    <title>Public</title>
    <!-- Service Worker Script -->
    <script async src="node_modules/tiny-https-server"></script>
</head>
<body>
    Public
</body>
</html>
```
Start a `/$` url that bypasses the Service Worker cache.\
For example `/$service_worker_version`.

## Add a subdomain

```json
{
  "production": {
    "tiny_https_server": {
      "subdomains": {
        "www": {
          "document_root": "./public/www",
          "service_worker_version": "0.0.0",
          "content_delivery_network_url": "",
          "content_delivery_network_root": "",
          "precache_urls": null
        }
      }
    }
  }
}
```

## Config-sets file

config-sets.json [*Read more...*](https://github.com/manuel-lohmus/config-sets)
```json{
  "production": {
    "tiny_https_server": {
      "domain": "localhost",
      "port": 443,
      "logDir": "./log/tiny-https-server",
      "document_root": "./public/www",
      "directory_index": "index.html",
      "pathToError_404": "./error_404.html",
      "pathToPrivkey": "./cert/localhost-key.pem",
      "pathToCert": "./cert/localhost-cert.pem",
      "subdomains": {
        "www": {
          "document_root": "./public/www",
          "service_worker_version": "1.0.0",
          "content_delivery_network_url": "",
          "content_delivery_network_root": "",
          "precache_urls": null
        }
      },
      "cacheControl": {
        "fileTypes": {
          "webp": "max-age=2592000",
          "bmp": "max-age=2592000",
          "jpeg": "max-age=2592000",
          "jpg": "max-age=2592000",
          "png": "max-age=2592000",
          "svg": "max-age=2592000",
          "pdf": "max-age=2592000",
          "woff2": "max-age=2592000",
          "woff": "max-age=2592000",
          "image/svg+xml": "max-age=2592000",
          "html": "max-age=86400",
          "css": "max-age=86400",
          "js": "max-age=86400"
        }
      },
      "setHeaders": {
        "default": {},
        "/": {
          "X-Frame-Options": "DENY"
        }
      },
      "service_worker_version": "1.0.0",
      "content_delivery_network_url": "",
      "content_delivery_network_root": "",
      "precache_urls": null
    },
    "try_to_run": {
      "retrying": 10,
      "enabled": true
    },
    "log_report": {
      "logDir": "./log/log-report",
      "enabled": true,
      "clear_on_startup": false,
      "save_only_uncaughtException": true
    },
    "browse_url": {
      "launch_url": "",
      "enabled": true
    }
  },
  "development": {
    "tiny_https_server": {
      "port": 80,
      "subdomains": {
        "test": {
          "document_root": "./public/test"
        }
      }
    },
    "try_to_run": {
      "enabled": false
    },
    "log_report": {
      "logDir": "./log/log-report",
      "enabled": true,
      "clear_on_startup": true,
      "save_only_uncaughtException": false
    },
    "browse_url": {
      "launch_url": "https://localhost/",
      "enabled": true
    }
  }
}
```

Read more about the ['log-report'](https://github.com/manuel-lohmus/log-report) module.\
Read more about the ['try-to-run'](https://github.com/manuel-lohmus/try-to-run) module.\
Read more about the ['browse-url'](https://github.com/manuel-lohmus/browse-url) module.

## License


The MIT License [MIT](LICENSE)
```txt
Copyright (c) 2021 Manuel Lõhmus <manuel@hauss.ee>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```