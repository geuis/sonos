//SPOTIFY SEARCH
//http://ws.spotify.com/search/1/track?q=kaizers+orchestra)?

//SEARCH WSDL
//http://iheartradio.com/cc-common/sonos/production/WSDLAPI.php#

var util = require('util'),
    http = require('http'),
    interfaces = require('os').networkInterfaces(),
    Sonos = require('node-sonos'),
    request = require('request'),
    parsestring = require('xml2js').parseString,
    q = require('q'),
    rapg = require('rapgenius-js');

var app = {
  ip: null,
  port: 4000,
  eventTimeoutSeconds: 3550,
  sonos_host: null,
  sonos_port: null,
  sonos_addr: null,
  sonos: null,
  usernames: null,
  services: null,
  can_search: false, //only set true if services have been discovered and matched with users
  properties: {},
  speakerProperties: {},
  currentTrackHash: '',
  currentTrack: {},
  currentTrackPlaying: false,
  currentQueue: {songs:[]},

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
          app.sonos_addr = 'http://' + app.sonos_host + ':' + app.sonos_port;

          // Create client for Sonos
          app.sonos = new Sonos.Sonos(app.sonos_host, app.sonos_port);

          app.getSpeakerInfo();

          // Get user names for connected services on Sonos
          // Get available audio services
          // Need both to get session ids
          q.all([app.get_usernames(), app.get_services()]).then(function() {

            // finds users and stores session and username on the services object.
            // also removes un-matched services from the object
            app.match_services_and_users(function () {
              app.can_search = true;
            });
          });

          // Start notify server
          app.notify_server();

          // Start NOTIFY subscriptions.
          app.updateSubscriptions();

          // Built-in timeout is 3600 seconds. We renew a few before that.
          setInterval(function () {
            app.updateSubscriptions();
          }, app.eventTimeoutSeconds * 1000);

          // Commence non-API driven hacky crap
          // Start currentTrack detection and updates
          setInterval(function () {
            app.updateCurrentTrack();
            app.getQueue();
          }, 1000);

        });

      }

    }

    //start search for Sonos
    search_fn();
    var search_interval = setInterval(search_fn, 2000);

  },

  updateCurrentTrack: function () {
    app.sonos.currentTrack(function (err, data) {

      //not really a hash
      var hash = data.title + data.artist + data.album + data.duration;

      if (app.currentTrackHash === hash) {

        if (data.position > app.currentTrack.position) {
          app.currentTrack.position = data.position;
          io.sockets.emit('songTime', {position: data.position, duration: data.duration});
          
          if (app.currentTrackPlaying === false) {
            app.currentTrackPlaying = true;
            io.sockets.emit('playing', app.currentTrackPlaying);
          }
          
        } else {

          if (data.position === app.currentTrack.position && app.currentTrackPlaying === true) {
            // set to false
            app.currentTrackPlaying = false;
            io.sockets.emit('playing', app.currentTrackPlaying);
          }

        }

      } else {

        app.currentTrack = data;
        app.fixAlbumArtURL(app.currentTrack)
        app.currentTrackHash = hash;
        io.sockets.emit('songChange', app.currentTrack);

        // lookup song lyrics
        app.lyric_search();

      }

    });
    
  },

  fixAlbumArtURL: function (obj) {
    obj.albumArtURI = obj.albumArtURI || obj.albumArtURL || '';
    obj.albumArtURL = obj.albumArtURL || obj.albumArtURI || '';

    if (obj.albumArtURI.indexOf(app.sonos_addr) === -1) {
      obj.albumArtURI = app.sonos_addr + obj.albumArtURI;
    }
    if (obj.albumArtURL.indexOf(app.sonos_addr) === -1) {
      obj.albumArtURL = app.sonos_addr + obj.albumArtURL;
    }
  },

  getQueue: function () {

    var CONTENT_DIRECTORY_ENDPOINT = '/MediaServer/ContentDirectory/Control';
    var BROWSE_ACTION = 'urn:schemas-upnp-org:service:ContentDirectory:1#Browse';
    var body = '<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1"><ObjectID>Q:0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>dc:title,res,dc:creator,upnp:artist,upnp:album,upnp:albumArtURI</Filter><StartingIndex>{0}</StartingIndex><RequestedCount>{1}</RequestedCount><SortCriteria></SortCriteria></u:Browse>';

    app.sonos.request(CONTENT_DIRECTORY_ENDPOINT, BROWSE_ACTION, body, 'u:BrowseResponse', function (err, json) {
      if (err) { console.log(err); };

      var queue = [];
      parsestring(json[0].Result, function (err, json) {

        json['DIDL-Lite'].item.forEach(function (item) {

          var entry = {
            queue_id: item.$.id.replace('Q:0/','')*1,
            title: util.isArray(item['dc:title']) ? item['dc:title'][0]: null,
            artist: util.isArray(item['dc:creator']) ? item['dc:creator'][0]: null,
            album: util.isArray(item['upnp:album']) ? item['upnp:album'][0]: null,
            albumArtURI : util.isArray(item['upnp:albumArtURI']) ? item['upnp:albumArtURI'][0] : null,
            duration: item.res[0].$.duration
          };
          app.fixAlbumArtURL(entry);
          queue.push(entry);

        });

      });

      //do socket notification
      if (queue.length !== app.currentQueue.songs.length) {
        app.currentQueue = {songs: queue};
        io.sockets.emit('queue', app.currentQueue);
      }

    });
  },

  playFromQueue: function (index) {
    // first, set the queue itself as the source URI
    var uri = 'x-rincon-queue:' + app.speakerProperties.LocalUID+ '#0';
    var TRANSPORT_ENDPOINT = '/MediaRenderer/AVTransport/Control';
    var SET_TRANSPORT_ACTION = 'urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI';
    var body = '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><CurrentURI>'+ uri +'</CurrentURI><CurrentURIMetaData></CurrentURIMetaData></u:SetAVTransportURI>';

    app.sonos.request(TRANSPORT_ENDPOINT, SET_TRANSPORT_ACTION, body, 'u:SetAVTransportURIResponse', function (err, json) {

      //crappy handling here for none responses
      if (!err) {

        var SEEK_TRACK_BODY_TEMPLATE = '<u:Seek xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>'+ (index) +'</Target></u:Seek>';
        var SEEK_ACTION = 'urn:schemas-upnp-org:service:AVTransport:1#Seek';

        app.sonos.request(TRANSPORT_ENDPOINT, SEEK_ACTION, SEEK_TRACK_BODY_TEMPLATE, 'test', function (err, json) {
//          console.log(err, json);
        });

      }

    });
    
  },

  getSpeakerInfo: function () {

    request(app.sonos_addr + '/status/zp', function (err, res, body) {
      parsestring(body, function (err, json) {

        if (err) console.log(err);

        for (var i in json.ZPSupportInfo.ZPInfo[0]) {
          app.speakerProperties[i] = json.ZPSupportInfo.ZPInfo[0][i][0];
        }

      });
    });

  },

  lyric_search: function () {

    // Lookup lyrics for current song
    var url = [
      'http://api.musixmatch.com/ws/1.1/matcher.lyrics.get?',
      '&apikey=980862525d06e6c0299f2a937e4b1485',
      '&q_track=' + app.currentTrack.title,
      '&q_artist=' + app.currentTrack.artist
    ].join('');

    request(url, function (err, res, json) {
      if (err) {
        console.log('ERR', err);
      } else {

        json = JSON.parse(json);

        if (json.message.header.status_code === 200) {
          if (json.message.body.lyrics.lyrics_body !== '') {
            app.currentLyrics = json.message.body.lyrics.lyrics_body.replace('******* This Lyrics is NOT for Commercial use *******', '');
            io.sockets.emit('songLyrics', {title: app.currentTrack.title, lyrics: app.currentLyrics});
          }
        }

      }
    });

  },

  match_services_and_users: function () {

    var defer = q.defer();

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

      defer.resolve();
      // Pandora doesn't show up in the services list for some reason.
      // May need to try handling this on its own.

    });

    return defer.promise;
  },

  get_usernames: function () {
    var defer = q.defer();

    // Really hack way to do this. Usernames for each service is encrypted by Sonos. We can still get them from
    // this endpoint and test them against all available services elsewhere to determine where they belong
    request(app.sonos_addr + '/status/securesettings', function (err, res, body) {

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

  // update ever X seconds to re-subscribe to notifications
  updateSubscriptions: function () {

    app.subscribeEvent('ZoneGroupTopology');
    app.subscribeEvent('MediaServer/ContentDirectory');
    app.subscribeEvent('AlarmClock');
    app.subscribeEvent('MusicServices');
    app.subscribeEvent('MediaRenderer/AVTransport');
    app.subscribeEvent('MediaRenderer/RenderingControl');

  },

  subscribeEvent: function (subscriptionType) {
    var defer = q.defer();

    var subscribe = http.request({
      method: 'SUBSCRIBE',
      headers: {
        'CALLBACK': '<http://' + app.ip + ':'+ app.port +'/notify>',
        'TIMEOUT': 'Second-' + app.eventTimeoutSeconds,
        'NT': 'upnp:event',
        'Server': 'Linux UPnP/1.0 Sonos/24.0-71060 (ZPS5)'
      },
      host: app.sonos_host,
      port: app.sonos_port,
      path: '/' + subscriptionType + '/Event'
    }, function (res) {

      var body = new Buffer(0);
      res.on('data', function (chunk) {
        body = body + chunk;
      })
      .on('end', function () {
        defer.resolve(body.toString());
      });

    }).on('error', function (err) {
      defer.reject(err);
    });
    subscribe.end();

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
        parsestring(body.toString(), function (err, json) {

          if (err) {
            console.log(err);
          } else {

            json['e:propertyset']['e:property'].forEach(function (item) {

              for (var i in item) {
                var prop = item[i][0];

                // shitty check if property is xml or not
                if (prop[0] === '<' && prop[prop.length-1] === '>') {
                  parsestring(prop, function (err, json) {
                    prop = json;
                  });
                }

                //LastChange prop is duplicated with different data
                if (i === 'LastChange') {
                  app.properties['LastChange:' + prop.Event.$.xmlns] = prop.Event;
                } else {
                  app.properties[i] = prop;
                }

              }

            });
          }
          console.log('---');
        });

        res.end('');

      })
      .on('error', function (err) {
        console.log('notify_server:', new Error(err));
      });

    }).listen(app.port);
  }

}

// Socket IO stuff
var io = require('socket.io').listen(9001);
io.sockets.on('connection', function (socket) {
  //send current song data
  socket.emit('songChange', app.currentTrack);
  socket.emit('songLyrics', {title: app.currentTrack.title, lyrics: app.currentLyrics});
  socket.emit('queue', app.currentQueue);

  io.sockets.emit('playing', app.currentTrackPlaying);

  // commands from clients
  socket.on('previous', function () {
    app.sonos.previous(function (err, isPrevious) {
      if (isPrevious) {
        io.sockets.emit('previous');
      }
    })
  });
  socket.on('next', function () {
    app.sonos.next(function (err, isNext) {
      if (isNext) {
        io.sockets.emit('next');
      }
    })
  });

  socket.on('pause', function () {
    app.sonos.pause(function (err, paused) {
    
      if (paused) {
        app.currentTrackPlaying = false;
      } else {
        app.currentTrackPlaying = true;
      }
      io.sockets.emit('playing', app.currentTrackPlaying);

    });
  });
  socket.on('play', function () {
    app.sonos.play(function (err, playing) {

      if (playing) {
        app.currentTrackPlaying = true;
      } else {
        app.currentTrackPlaying = false;
      }
      io.sockets.emit('playing', app.currentTrackPlaying);

    });
  });

  socket.on('playFromQueue', function (index) {
    app.playFromQueue(index);
    io.sockets.emit('playing', app.currentTrackPlaying);
  });

  socket.on('disconnect', function () {
    io.sockets.emit('user disconnected');
  });

});

module.exports = app;



// Unsubscribe from these when quitting the app
//https://www.dropbox.com/s/lcjmcovmnd2cyi3/Screenshot%202014-03-12%2015.55.41.png

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
