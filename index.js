var Q = require('bluebird');
var fs = require('fs');
var path = require('path');
var YT = require('ytdl-core');
var sh = require('shelljs');
var readDir = require('readdir');
var _ = require('lodash');
var xml2js = require('xml2js');
var XMLHttpRequest = require('xhr2');
var SIDX = require('./lib/sidx');
//mp4 and m4a dash codes

//720p, 480p, 360p
var DASH_VIDEO_RESOLUTIONS = ['720p', '480p', '360p', '240p', '144p'];
var DASH_VIDEO_TAGS = ['136', '135', '134', '133', '160'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;
var ITAG_DASH_TRESHOLD = 100

var SidxInterface = (() => {

  var parser = new xml2js.Parser();
  var _tempSaveDir = __dirname
    /*
    API
    */
  function start(options) {
    options = options || {};
    if (options.audioOnly) {
      delete options.resolution;
    }

    if (options.resolution) {
      var startRes = DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution);
      if (startRes >= 0) {
        var clone = [].concat(DASH_VIDEO_RESOLUTIONS);
        options.dashVideoResolutions = clone.splice(startRes, DASH_VIDEO_RESOLUTIONS.length);
      }
    }

    /*if (options.audioOnly && options.videoOnly) {
      options.videoOnly = true;
      options.audioOnly = false;
    }*/

    if (typeof options.youtubeDl === 'undefined') {
      options.youtubeDl = true
    }

    if (typeof options.chooseBest === 'undefined') {
      options.chooseBest = true
    }

    options.videoOnly = Boolean(options.videoOnly)
    options.audioOnly = Boolean(options.audioOnly)

    options.audioOnly = options.audioOnly;
    options.videoOnly = options.videoOnly;
    options.container = options.container || 'mp4'


    return new Q((resolve, reject) => {

      var id = options.id;
      if (!id) {
        reject('specify id in args: --id ');
        return;
      }
      var url = VIDEO_BASE + id;
      console.log(`Requesting info for ${url}`);
      YT.getInfo(url, function(err, info) {
        if (!info) {
          reject(`failed to get info on ${id}`);
        } else {
          console.log(`Got info for ${id}`);
          chooseMediaFormat(info.formats, options)
            .then(function(data) {
              resolve(data);
            }).catch(function(err) {
              reject(err);
            });
        }
      });
    });
  }

  function getURL(videoId, itag) {
    return new Q((resolve, reject) => {

      var _cmd = `youtube-dl ${VIDEO_BASE}${videoId} --skip-download -f ${itag} -g -q`
      var run = sh.exec(_cmd, (code, stdout, stderr) => {
        if (code !== 0) {
          err = new Error('Command failed ' + _cmd);
          reject(err)
        } else {
          resolve(stdout)
        }
      });
      return

      if (run.code !== 0) {
        err = new Error('Command failed ' + _cmd);
      }

      var url = VIDEO_BASE + videoId;
      YT.getInfo(url, (err, info) => {
        if (!info) {
          reject(`failed to get info on ${videoId}`);
          return;
        }

        let _url = _.compact(info.formats.map(format => {
          if (format.itag === itag) {
            return format.url
          }
          return null
        }))[0]
        resolve(_url)
      });
    });
  }

  function setTempSaveDir(dir) {
    _tempSaveDir = dir
  }

  //******************
  //PRIVATE
  //******************


  function chooseMediaFormat(formats, options) {
    var mimetpye = _getMimeType(options)
      //fs.writeFileSync(`d.json`, JSON.stringify(formats, null, 4), 'utf-8')
      //fs.writeSync('d.json', JSON.stringify(formats, null, 4))
      /*var choices = formats.filter(function(rep) {
          var re = new RegExp(mimetpye);
          var valid = true;
          if (options.resolution) {
              if (options.dashVideoResolutions.indexOf(rep.resolution) < 0 || !rep.index) {
                  valid = false;
              }
          } else if (options.itag) {
              if (rep.itag !== options.itag) {
                  valid = false;
              }
          } else {
              if (options.videoOnly) {
                  if (DASH_VIDEO_TAGS.indexOf(rep.itag) < 0) {
                      valid = false;
                  }
              } else if (options.audioOnly) {
                  if (DASH_AUDIO_TAGS.indexOf(rep.itag) < 0) {
                      valid = false;
                  }
              }
          }
          return valid;
      });*/


    var choices = formats.filter(choice => {
        return options.container === choice.container
      }).filter(choice => {
        //itag eval, remove the non dashed ones
        return parseInt(choice.itag, 10) > ITAG_DASH_TRESHOLD
      })
      .filter(choice => {
        return options.audioOnly === !!choice.audioEncoding
      })
      /*
          filter(function(rep) {
            var re = new RegExp(mimetpye);
            console.log(rep.type);
            console.log(rep);
            if(!rep.type){
              return false
            }
            return rep.type.match(re)
          }).filter(choice => {
            return options.audioOnly === !!choice.audioEncoding
          })*/


    //ones that have an index range
    var filteredCorrectly = choices.filter(choice => {
      return choice.index
    })

    if (options.resolution) {

      let _r = [...DASH_VIDEO_RESOLUTIONS]
      let _resolutionSelection = _r.slice(DASH_VIDEO_RESOLUTIONS.indexOf(options.resolution))

      filteredCorrectly = _.compact(_.flatten(_resolutionSelection.map(resolution => {
        return [...filteredCorrectly].map(item => {
          if (item.resolution === resolution) {
            return item
          } else {
            null
          }
        })
      })))

      /*
      Filter and make lowest at top
      */
      if (!filteredCorrectly.length) {
        filteredCorrectly = choices.filter(choice => {
          return choice.index
        }).reverse()
        if (!options.chooseBest) {
          filteredCorrectly.reverse()
        }
      }
    }

    return new Q((resolve, reject) => {
      console.log(filteredCorrectly);
      if (filteredCorrectly.length) {
        console.log(`Got a match with an index range for ${options.id}`);
        //pick top, length 1
        let _choice = filteredCorrectly.splice(0, 1)[0];
        _choice.videoId = options.id
        _prepareData(_choice)
        resolve(getSidx(_choice))
          /*resolve(Q.map(_choices, (choice) => {
              _prepareData(choice)
              return getSidx(choice);
          })[0]);*/
      } else if (options.youtubeDl) {
        console.log(`Trying youtubeDl for ${options.id}`);
        if (!options.chooseBest) {
          choices.reverse()
        }
        resolve(tryYoutubeDl(choices[0], options))
      } else {
        resolve()
      }
    })
  }

  function tryYoutubeDl(object, options) {
    var id = options.id
    var videoUrl = VIDEO_BASE + id;
    var Out = {
      info: object,
      codecs: undefined,
      indexRange: undefined,
      url: object.url,
      videoId: options.id,
      sidx: undefined
    }
    console.log(Out);
    return new Q(function(resolve, reject) {
      var _downloadDir = path.join(_tempSaveDir, id)
      var mimetpye = _getMimeType(options)
      if (fs.existsSync(_downloadDir)) {
        sh.exec(`rm -rf ${_downloadDir}`)
      }
      fs.mkdirSync(_downloadDir)
      fs.chmodSync(_downloadDir, '0777')
      sh.cd(_downloadDir)
      var _cmd = `youtube-dl ${videoUrl} --skip-download -v --write-pages`
      var run = sh.exec(_cmd);
      if (run.code !== 0) {
        err = new Error('Command failed ' + _cmd);
      }
      var filesArray = readDir.readSync(_downloadDir, ['**.dump'], readDir.ABSOLUTE_PATHS);
      var manifests = filesArray.filter(function(p) {
        return p.indexOf('manifest') > -1
      })
      var iTags = options.videoOnly ? DASH_VIDEO_TAGS : DASH_AUDIO_TAGS
      manifests.forEach(function(p) {
        var xml = fs.readFileSync(p, 'utf-8')
        parser.parseString(xml, function(err, result) {
          var adpatation = result.MPD.Period[0].AdaptationSet;
          var byMime = adpatation.filter(set => {
            return set.$.mimeType === mimetpye
          })[0]

          let _reps = byMime.Representation.filter(rep => {
            var _r = false
            var repVars = rep.$
            if (iTags.indexOf(repVars.id) > -1) {
              var segmentList = rep.SegmentList
              if (segmentList[0].SegmentURL[0].$.media.indexOf('range') > -1) {
                _r = true
              }
            }
            return _r
          })

          _reps.forEach(rep => {
            var repVars = rep.$
            if (iTags.indexOf(repVars.id) > -1 && !Out.codecs) {
              delete Out.info
              Out.url = rep.BaseURL[0]
              Out.codecs = repVars.codecs
              Out.resolution = `${repVars.height}p`
              Out.itag = DASH_VIDEO_TAGS[DASH_VIDEO_RESOLUTIONS.indexOf(Out.resolution)]
              var segmentList = rep.SegmentList || rep.SegmentBase
              var indexRange
              if (segmentList[0].$) {
                let _ii = segmentList[0].$.indexRange.split('-')[1]
                indexRange = `0-${_ii}`
              } else {
                var _i = segmentList[0].SegmentURL[0].$.media.replace('range/', '').split('-')[0]
                var _iParsed = parseInt(_i, 10) - 1
                indexRange = `0-${_iParsed}`
              }
              Out.indexRange = indexRange
              Out.youtubeDl = true
              console.log(Out);
              sh.cd(_tempSaveDir)
                //sh.exec(`rm -rf ${_downloadDir}`)
              resolve(getSidx(Out))
            }
          })
        });
      })
    });
  }

  function _getMimeType(options) {
    return options.audioOnly ? `audio/${options.container}` : `video/${options.container}`;
  }

  //*********************
  //INDEX
  //*********************

  /*
  prepare the data coming from ytdl core
  */
  function _prepareData(choice) {
    var url = choice.url;
    var cdex, codecs, indexRange
    if (choice.type) {
      cdex = choice.type.split('codecs=\"')[1];
      codecs = cdex.substring(0, cdex.length - 1);
      choice.codecs = codecs
    }
    if (choice.index) {
      indexRange = "0-" + choice.index.split('-')[1];
      choice.indexRange = indexRange
    }
    return choice
  }

  /*
  {
      url
      codecs
      indexRange
      data
  }
  */
  function getSidx(choice) {
    return new Q(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', choice.url);
      xhr.setRequestHeader("Range", "bytes=" + choice.indexRange);
      xhr.responseType = 'arraybuffer';
      xhr.addEventListener("readystatechange", () => {
        if (xhr.readyState == xhr.DONE) { // wait for video to load
          // Add response to buffer
          xhr.removeEventListener("readystatechange", arguments.callee)
          var p = SIDX.parseSidx(xhr.response);
          if (!p) {
            reject(`Failed on SIDX parse for ${choice.videoId}`);
          } else {
            console.log(`Parsed SIDX for ${choice.videoId}`);
            resolve({
              info: choice,
              youtubeDl: !!choice.youtubeDl,
              codecs: choice.codecs,
              indexRange: choice.indexRange,
              url: choice.url,
              videoId: choice.videoId,
              sidx: p
            });
          }
        }
      }, false);
      xhr.send();
    });
  }
  return {
    start: start,
    getURL: getURL,
    setTempSaveDir: setTempSaveDir
  }

})();

module.exports = SidxInterface;