var Q = require('bluebird');
const spawn = require('child_process').spawnSync
var fs = require('fs');
var readFile = Q.promisify(require('fs').readFile);
var path = require('path');
var YT = require('ytdl-core');
var readDir = require('readdir');
var xml2js = require('xml2js');
var xhr = require('xhr-request');
var checkTypes = require('check-types');
var compact = require('lodash/compact');
var flatten = require('lodash/flatten');
var assign = require('lodash/assign');
var QString = require('query-string');
var SIDX = require('./lib/sidx');
//mp4 and m4a dash codes

//720p, 480p, 360p
var CODEC_MAPS = {
  139: `codecs="mp4a`,
  140: `codecs="mp4a`,
  141: `codecs="mp4a`
};

var DASH_VIDEO_RESOLUTIONS = ['720p', '480p', '360p', '240p', '144p'];
var DASH_VIDEO_TAGS = ['136', '135', '134', '133', '160'];
var DASH_AUDIO_TAGS = ['139', '140', '141'];
var DASH_ITAGS = [...DASH_VIDEO_TAGS, ...DASH_AUDIO_TAGS]
var VIDEO_PATH = '/watch?v=';
var VIDEO_BASE = 'https://www.youtube.com' + VIDEO_PATH;
var ITAG_DASH_TRESHOLD = 100

const codecsFromType = type => {
  if (!type) return ""
  let cdex = type.split('codecs=\"')[1] || "";
  const codecs = cdex.substring(0, cdex.length - 1);
  return codecs
}

const removeDuplicates = (arr, prop) => {
  var new_arr = [];
  var lookup = {};

  for (var i in arr) {
    lookup[arr[i][prop]] = arr[i];
  }

  for (i in lookup) {
    new_arr.push(lookup[i]);
  }

  return new_arr;
}


const extractCodecs = (str) => {
  const s = codecsFromType(str)
  return s.split('&')[0]
};

const extractItag = (str) => {

};

const indexRangeFromFormat = (init, index) => {

}

const _sniffItagFrom = (dumpUrl) => {
  let itag = dumpUrl.split('itag/')[1].substring(0, 3)
  return itag
}


/*
probably could scrap ytdl core and just use the itags with youtube-dl

*/

var SidxInterface = (() => {

  var youtubeDlPath = process.env.YOUTUBE_DL_PATH || 'youtube-dl'

  console.log("youtubeDlPath", youtubeDlPath);


  var _tempSaveDir = __dirname
    /*
    API
    */
  function start(options) {

    var itags = options.itags
    var id = options.id || options.videoId;
    var videoiTags = options.videoOnly ? DASH_VIDEO_TAGS : []
    var audioiTags = options.audioOnly ? DASH_AUDIO_TAGS : []
    var iTags = [...DASH_ITAGS]

    var username = options.username
    var password = options.password

    var loginCommand = ""
    if (!!username && !!password) {
      loginCommand = `-u ${username} -p ${password}`
    }
    var _cmd = `${youtubeDlPath} ${VIDEO_BASE}${id} -F ${loginCommand}`

    console.log(_cmd);

    return new Q((yes, no) => {
      let args = [`${VIDEO_BASE}${id}`, `-F`]
      if (loginCommand.length) args = args.concat(loginCommand.split(" "));

      console.log(args);

      const child = spawn(`${youtubeDlPath}`, args)
      const stderr = child.stderr.toString('utf-8');
      const stdout = child.stdout.toString('utf-8');

      if (stderr.length) {
        console.log(`ERROR on: ${_cmd}`);
        return no(stderr)
      }

      let availableItags = stdout.split('\n')
        .filter(line => {
          return iTags.filter(itag => {
            return line.indexOf(itag) > -1
          }).length
        })
        .map(unformated => {
          return compact(
            iTags.filter(itag => {
              return unformated.indexOf(itag) > -1
            })
          )[0]
        })

      let desiredTags = itags.filter(t => {
        return availableItags.indexOf(t) > -1
      })

      if (!desiredTags.length) {
        desiredTags = options.audioiTags ? [...DASH_AUDIO_TAGS] : [...DASH_VIDEO_TAGS]
      }
      console.log(`Looking for ${desiredTags.join(',')} itags`);

      var _c = `${youtubeDlPath}  ${VIDEO_BASE}${id} --skip-download -v --write-pages --no-warnings${loginCommand}`

      /*const cwd = process.cwd()
      if(fs.existsSync(id)){
        spawn('rm', ['-rf', id])
      }
      fs.mkdirSync( id)

      process.chdir(_tempSaveDir)
    */
      console.log(_c);

      const cwd = process.cwd()

      process.chdir(_tempSaveDir)

      let mpdSpawn = spawn(`${youtubeDlPath}`, [`${VIDEO_BASE}${id}`, `--skip-download`, '-v', '--write-pages', '--no-warnings'].concat(loginCommand.split(" ")))

      var parser = new xml2js.Parser();
      const parseString = Q.promisify(parser.parseString)
      var filesArray = readDir.readSync(process.cwd(), ['**.dump'], readDir.ABSOLUTE_PATHS);

      process.chdir(cwd)

      var foundItags = []
      console.log(`Got ${filesArray.length} mpds`);

      yes(Q.map(filesArray, (p) => {

          return readFile(p, 'utf-8')
            .then(data => {
              return parseString(data)
                .then(result => {

                  if (result) {

                    if (result.MPD) {
                      var adpatation = result.MPD.Period[0].AdaptationSet;
                      var _reps = flatten(adpatation.map(av => {
                        return av.Representation.filter(rep => {
                          var _r = false
                          var repVars = rep.$
                          if (desiredTags.indexOf(repVars.id) > -1 &&
                            foundItags.indexOf(repVars.id) < 0) {

                            foundItags.push(repVars.id)
                            var segmentList = rep.SegmentList || rep.SegmentBase
                            if (segmentList) {
                              _r = true
                            }
                          }
                          return _r
                        })
                      }))

                      console.log(`Reps: ${_reps.length} foundItags: ${foundItags.length}`);

                      if (_reps.length) {

                        return Q.map(_reps, rep => {
                          let _o = assign({}, { videoId: id })
                          var repVars = rep.$

                          /*REQUIRED*/
                          _o.url = rep.BaseURL[0]
                          _o.url = _o.url._ || _o.url
                          _o.codecs = repVars.codecs
                          _o.itag = repVars.id
                          var segmentList = rep.SegmentList || rep.SegmentBase
                          var indexRange;
                          if (segmentList[0].$) {
                            let _ii = segmentList[0].$.indexRange.split('-')[1]
                            if (isNaN(_ii)) {
                              return null
                            }
                            indexRange = `0-${_ii}`
                          } else {
                            var _i = segmentList[0].SegmentURL[0].$.media.replace('range/', '').split('-')[0]
                            var _iParsed = parseInt(_i, 10) - 1;
                            if (isNaN(_iParsed)) {
                              return null
                            }
                            indexRange = `0-${_iParsed}`
                          }
                          _o.indexRange = indexRange

                          console.log(_o);
                          /*REQUIRED*/
                          return getSidx(_o)
                        })

                      } else {
                        console.log(`No Reps `);
                        return null
                      }
                    } else {
                      console.log(`No mpd `);
                      return null
                    }

                  }
                })
                .catch(err => {
                  console.log(`parse error `);
                  return null
                })
            })
        })
        .then(results => {
          const r = compact(flatten(results))
          if (r.length) {
            _deleteMpds(filesArray, id)
            return r
          } else {
            return _bruteReading(filesArray, desiredTags, id)
              .then(datas => {
                _deleteMpds(filesArray, id)
                if (datas.length) {
                  return Q.map(datas, data => getSidx(data))
                } else {
                  return _getInfo(desiredTags, id)
                }
              })
          }
        }))
    })
    return Q.resolve()
  }


  function _bruteReading(filesArray, desiredTags, id) {
    return Q.map(filesArray, (p) => {
        return readFile(p, 'utf-8')
          .then(data => {
            let decode;
            try {
              decode = decodeURIComponent(data)
            } catch (e) {
              return null
            }

            return Q.map(desiredTags, itag => {

              let _o = assign({}, { videoId: id })

              decode = decodeURIComponent(decode)
              const split = decode.split('url=')

              const chunks = split.filter(chunk => {
                return ((chunk.indexOf(`&itag=${itag}`) > -1) &&
                  (chunk.indexOf(`/mp4`) > -1)
                )
              })

              return Q.map(chunks, chunk => {
                return getURL(id, itag)
                  .then(url => {

                    const qs = QString.parse(chunk)

                    //dont bother
                    if (checkTypes.array(qs.index) || !qs.index) {
                      return null
                    }
                    if (checkTypes.array(qs.type) || !qs.type) {
                      return null
                    }

                    _o.url = url
                    _o.codecs = codecsFromType(qs.type)
                    _o.itag = itag
                    _o.indexRange = `0-${parseInt(qs.index.split('-')[1],10)}`
                    return _o
                  })
              }).then(r => (flatten(r)))
            }).then(r => (flatten(r)))
          }).then(r => (flatten(r)))
      })
      .then(results => {
        return removeDuplicates(compact(flatten(results)), 'itag')
      })
  }

  function _deleteMpds(filesArray, id) {
    filesArray.forEach(p => {
      try {
        fs.unlinkSync(p)
      } catch (e) {

      }
    })
    spawn('rm', ['-rf', id])
  }

  function _getInfo(iTags, id) {
    return new Q((resolve, reject) => {
      YT.getInfo(`${VIDEO_BASE}${id}`, (err, info) => {
        if (!info) {
          console.log(`failed to get info on ${id}`);
          reject(new Error(`failed to get info on ${id}`));
        } else {
          console.log(`Got info for ${id}`);
          return resolve(Q.map(compact(info.formats.map(fmt => {
            if (iTags.indexOf(fmt.itag) > -1 && fmt.index) {
              return {
                videoId: id,
                url: fmt.url,
                codecs: codecsFromType(fmt.type),
                itag: fmt.itag,
                indexRange: "0-" + fmt.index.split('-')[1]
              }
            } else {
              return null
            }
          })), choice => (getSidx(choice))))
        }
      });
    });
  }

  function getURL(videoId, itag, remote = {}) {
    console.log(`getURL ${videoId} ${itag}`);
    console.log(remote);
    console.log('\n');

    return new Q((resolve, reject) => {

      if (remote.url) {
        xhr(remote.url, {
          method: 'GET',
          json: true,
          query: {
            itag: itag,
            url: `${VIDEO_BASE}${videoId}`
          }
        }, (err, data, response) => {
          if (err) {
            console.log(err);
            reject(err)
          } else {
            resolve(data)
          }
        })
      } else {

        spawn('chmod', ['a+rx', youtubeDlPath])
        const cwd = process.cwd()
        process.chdir(_tempSaveDir)
        const child = spawn(`${youtubeDlPath}`, [`${VIDEO_BASE}${videoId}`, `--skip-download`, `-f ${itag}`, '-g', '-q', '-i'])
        process.chdir(cwd)

        if (child.stderr.toString('utf-8').length) {
          console.log(`ERROR on: ${_c}`);
          return reject(stderr)
        }

        resolve(child.stdout.toString('utf-8'))
      }
    });
  }

  function _doSidxXhr(choice, resolve, reject, count = 0) {
    let { url, indexRange } = choice
    xhr(choice.url, {
      method: 'GET',
      responseType: 'arraybuffer',
      headers: {
        'Range': `bytes=${choice.indexRange}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.143 Safari/537.36'
      },
    }, (err, data, response) => {

      if (err) {
        console.log(err);
        reject(err)
      } else {
        if (data.byteLength === 0) {
          return reject(new Error("Arraybuffer was empty"))
        }
        var p = SIDX.parseSidx(data);
        if (!p) {
          reject(`Failed on SIDX parse for ${choice.videoId}`);
        } else {
          console.log(`Parsed SIDX for ${choice.videoId}`);
          resolve(assign(choice, {
            codecs: choice.codecs,
            indexRange: choice.indexRange,
            url: choice.url,
            videoId: choice.videoId,
            sidx: p
          }));
        }
      }
    })
  }

  function getSidx(choice) {
    return new Q((resolve, reject) => {
      _doSidxXhr(choice, resolve, reject)
    });
  }

  function setYoutubeDLPath(p) {
    if (p) {
      if (fs.existsSync(p)) {
        youtubeDlPath = p
        spawn('chmod', ['a+rx', youtubeDlPath])
        console.log("setYoutubeDLPath", youtubeDlPath);
      }
    }
  }

  function setTempSaveDir(dir) {
    _tempSaveDir = dir
  }

  return {
    start: start,
    getURL: getURL,
    setYoutubeDLPath: setYoutubeDLPath,
    setTempSaveDir: setTempSaveDir
  }

})();

module.exports = SidxInterface;
