//https://github.com/jishi/node-sonos-http-api
// GET USERNAMES FROM HERE
//status/securesettings

//SPOTIFY SEARCH
//http://ws.spotify.com/search/1/track?q=kaizers+orchestra)?

//SEARCH WSDL
//http://iheartradio.com/cc-common/sonos/production/WSDLAPI.php#

var http = require('http'),
    interfaces = require('os').networkInterfaces(),
    Sonos = require('node-sonos'),
    request = require('request'),
    parsestring = require('xml2js').parseString,
    q = require('q');

var app = {
  ip: null,
  port: 3401,
  sonos_host: null,
  sonos_port: null,
  sonos: null,
  usernames: null,
  services: null,

  init: function () {

    // Get network ip
    var ip = null;
    for (var i in interfaces) {
      if (ip !== null) { break; }
      var face = interfaces[i];
      for(var b = 0; b < face.length; b++) {
        if (face[b].family === 'IPv4' && !face[b].internal) {
          ip = face[b].address;
          break;
        }
      }
    }
    app.ip = ip;

    // Start search loop for Sonos
    var search_count = 4;
    var search_fn = function () {

      if (search_count-- === 0) {

        clearInterval(search_interval);
        console.log('Unable to find Sonos system on the network.');

      } else {

        console.log('Searching');

        // Look for Sonos on the network
        Sonos.search(function (device) {

          // Sonos found, cancel search
          clearInterval(search_interval);
          console.log('Found Sonos system');

          // store device info
          app.sonos_host = device.host;
          app.sonos_port = device.port;

          // Create client for Sonos
          app.sonos = new Sonos.Sonos(this.sonos_host, this.sonos_port);

          // Start notify server
          app.notify_server();

          // Get user names for connected services on Sonos
          // Get available audio services
          // Need both to get session ids
          q.all([app.get_usernames(), app.get_services()]).then(function() {

            // finds users and stores session and username on the services object.
            // also removes un-matched services from the object
            app.match_services_and_users();

          }, function (err) {
            console.log(err);
          });

        });

      }

    }

    //start search for Sonos
    search_fn();
    var search_interval = setInterval(search_fn, 2000);

  },

  match_services_and_users: function () {

    var promises = [];
    for (var name in app.usernames) {
      for(var srv in app.services) {
        promises.push(app.get_sessionid(srv, app.services[srv].Id, name));
      }
    }
    q.all(promises).then(function (results) {

      var obj = {};
      results.forEach(function (item, i) {
        //if no session, remove the service from app.services
        if (item.session_id) {
          obj[item.service] = app.services[item.service];
          obj[item.service].username = item.username;
          obj[item.service].session_id = item.session_id;
        }
      });

      app.services = obj;

// Pandora doesn't show up in the services list for some reason.
// May need to try handling this on its own.

    });

  },

  get_usernames: function () {
    var defer = q.defer();
    // Really hack way to do this. Usernames for each service is encrypted by Sonos. We can still get them from
    // this endpoint and test them against all available services elsewhere to determine where they belong
    request('http://' + app.sonos_host + ':' + app.sonos_port + '/status/securesettings', function (err, res, body) {

      var obj = {};
      parsestring(body, function (err, json) {

        if (err) defer.reject(err);

        parsestring(json.ZPSupportInfo.Command[0]._, function (err, json) {

          if (err) defer.reject(err);

          json.Setting.$.Value.split('XXXX,').forEach(function (item) {
            item = item.split(',');
            obj[item[1]] = {data: item, service: null, sessionId: null};
          });
          
        });

      });

      app.usernames = obj;
      defer.resolve();

    });
    
    return defer.promise;
  },
  
  get_services: function () {
    var defer = q.defer();

    var api = new Sonos.Services.MusicServices(app.sonos_host, app.sonos_port);
    api.ListAvailableServices({}, function (err, data) {
      if (err) defer.reject(err);

      parsestring(data.AvailableServiceDescriptorList, function (err, json) {
        if (err) defer.reject(err);

        var services = {};
        json.Services.Service.forEach(function (item) {

          // while possible to add beta services, we'll filter these out for now
          if (item.$.ContainerType !== 'SoundLab') {
            services[item.$.Name] = item.$;
          }

        });

        app.services = services;
        defer.resolve();
      });

    });

    return defer.promise;
  },

  get_sessionid: function (service_name, service_id, username) {
    var defer = q.defer();

    var x = new Sonos.Services.MusicServices(app.sonos_host, app.sonos_port);
    x.GetSessionId({ServiceId: service_id, Username: username}, function (err, data) {

      defer.resolve({
        service: service_name,
        username: username,
        session_id: data !== undefined ? data.SessionId : null
      });

    });
    return defer.promise;
  },
  
  notify_server: function () {
    http.createServer(function (req, res) {

      var body = new Buffer(0);
      req
      .on('data', function (chunk) {
        body = body + chunk;
      })
      .on('end', function () {
      
// do something with body
console.log('##', body.toString());
        res.end('');

      })
      .on('error', function (err) {
        console.log('notify_server:', new Error(err));
      });

    }).listen(app.port);
  }

}

app.init();

//setTimeout(function(){
//  // SUBSCRIBE
//  var subscribe = http.request({
//    method: 'SUBSCRIBE',
//    headers: {
//      'CALLBACK': '<http://' + app.ip + ':'+ app.port +'/notify>',
//      'TIMEOUT': 'Second-3600',
//      'NT': 'upnp:event'
//    },
//    host: app.sonos_host,
//    port: app.sonos_port,
//    path: '/ZoneGroupTopology/Event'
//  }, function (res) {
//
//    var body = [];
//    res.on('data', function (data) {
//      body.push(data);
//    })
//    .on('end', function () {
//      console.log(body.join(''));
//    });
//
//  }).on('error', function (err) {
//    console.log('senderr:', err);
//  });
//  subscribe.end();
//}, 4000);





//});





//rebecca black player.queueNext('http://radio.db0.fr/mp3/MEMES/Rebecca%20Black%20-%20Friday.mp3', function (err, playing) {
//  player.queueNext('http://livingears.com/music/SceneNotHeard/091909/Do%20You%20Mind%20Kyla.mp3', function (err, playing) {
//    console.log(err, playing);
//    //then player.play(err, playing)
//    player.play(function (err, playing) {
//      console.log(err, playing);
//    });
//  });

//  player.currentTrack(function (err, track) {
//    console.log(err, track);
//  });

//id: 11
