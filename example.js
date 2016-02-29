var fs = require('fs');
var path = require('path');
var Interface = require('./sidx_interface');

var ID = '0uXssTfeHZM';
Interface.start({ id: ID }).then(results => {
    fs.writeFileSync(path.join(process.cwd(), `${ID}.json`), JSON.stringify(results, null, 4), 'utf-8');
    console.log(results);
});