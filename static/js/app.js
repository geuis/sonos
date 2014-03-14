(function () {
  var app = {
    socket_address: 'http://charles-macbook.local:9001',
    socket: null,
    templates: {},
    init_templates: function () {

      $('[template]').each(function () {

        var el = $(this);
        var template = $(this).html();
        $(this).empty();

        app.templates[$(this).attr('template')] = function (data) {
          el.html(Mustache.render(template, data));
          el.addClass('show');
        };

      });

    },

    init_events: function () {
      for (var i in app.socketEvents) {
        app.socket.on(i, app.socketEvents[i]);
      }
      for (var i in app.interfaceEvents) {
        app.interfaceEvents[i]();
      }
    },

    socketEvents: {
      'songChange': function (data) {
        app.templates['player'](data);
      },
      'songTime': function (data) {
        app.templates['tracktime'](data);
      },
      'songLyrics': function (data) {
        app.templates['lyrics'](data);
      },
      'playing': function (isPlaying) {
        if (isPlaying) {
          app.interfaceChange.showPause();
        } else {
          app.interfaceChange.showPlay();
        }
      },
      'queue': function (data) {
        app.templates['queue'](data);
      }
    },

    interfaceEvents: {
      'pause': function () {
        $(document).on('click', '.pause', function (ev) {
          app.socket.emit('pause');
        });
      },
      'play': function () {
        $(document).on('click', '.play', function (ev) {
          app.socket.emit('play');
        });
      },
      'previous': function () {
        $(document).on('click', '.previous', function (ev) {
          app.socket.emit('previous');
        });
      },
      'next': function () {
         $(document).on('click', '.next', function (ev) {
          app.socket.emit('next');
        });
      },
      'playFromQueue': function () {
        $(document).on('click', '.queue > div', function (ev) {
          app.socket.emit('playFromQueue', $(this).attr('index'));
        });
      }
    },
 
    interfaceChange: {
      'showPlay': function (el) {
        $('.pause').removeClass('pause').addClass('play');
      },
      'showPause': function (el) {
        $('.play').removeClass('play').addClass('pause');
      }
    },

//      { name: '4.mp4', length: 13},
//      { name: '7.mp4', length: 78},
//      { name: '9.mp4', length: 23},
    videos: [
      { name: '1.mp4', length: 10},
      { name: '2.mp4', length: 60},
      { name: '3.mp4', length: 20},
      { name: '5.mp4', length: 96},
      { name: '6.mp4', length: 77},
      { name: '8.mp4', length: 15},
      { name: '10.mp4', length: 16}
    ],
    updateBackground: function () {
 
      var arr = app.videos.slice(0);

      //randomize array
      var i, t, j;
      for (i = arr.length - 1; i > 0; i -= 1) {
        t = arr[i];
        j = Math.floor(Math.random() * (i + 1));
        arr[i] = arr[j];
        arr[j] = t;
      }

      var fn = function () {

        if (arr.length > 0) {
          var vid = arr.pop();
          var targ = $('#bgvideo');
          targ.attr('src', '/static/videos/' + vid.name);
          targ[0].play();

          app.resizeBackgroundVideo();

          setTimeout(function () {
            fn();
          }, vid.length * 1000);

        } else {
          app.updateBackground();
        }

      }
      fn();
    },
 
    resizeBackgroundVideo: function () {
      var targ = $('#bgvideo');
      setTimeout(function () {

        var winwidth = $(window).width();
        var winheight = $(window).height();
        var targwidth = targ.width();
        var targheight = targ.height();

        var scale = 1 + Math.abs((winwidth / winheight) - (targwidth / targheight));

        targ.css({
          'margin-top': ((winheight - targheight) / 2) + 'px',
          'transform': 'scale('+scale+','+scale+')'
        });

      }, 100);
    }

  }

  app.updateBackground();
  window.app = app;
})();

$(function () {
  app.socket = io.connect(app.socket_address);
  app.init_templates();
  app.init_events();
 
  // allow full screen
  if( document.hasOwnProperty('webkitIsFullScreen') ){ //check if full screen supported
    $(document).keyup(function(ev){
      if( ev.which === 70 ){
        $('body')[0].webkitRequestFullScreen(Element.ALLOW_KEYBOARD_INPUT);

      }
    });
  }

  $(window).resize(function () {
    app.resizeBackgroundVideo();
    setTimeout(function(){
      app.updateBackground();
    },1000);
  });

});
