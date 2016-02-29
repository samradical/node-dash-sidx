var fs = require('fs');
var path = require('path');
var Interface = require('./index');

var ID = 'BBCFQtDLPA0';

var options = {
    id:ID,
    audioonly:true,
    videoobly:false
};

Interface.start(options).then(results => {
    fs.writeFileSync(path.join(process.cwd(), `${ID}.json`), JSON.stringify(results, null, 4), 'utf-8');
});