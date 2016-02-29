var fs = require('fs');
var path = require('path');
var Interface = require('./index');

var ID = '_QljnNIBtaI';

var options = {
    id:ID,
    chooseBest:true,
    resolution:'480p'
};

Interface.start(options).then(results => {
    fs.writeFileSync(path.join(process.cwd(), `${ID}.json`), JSON.stringify(results, null, 4), 'utf-8');
});
