const fs = require('fs');
const JSZip = require('jszip');

async function main() {
    const data = fs.readFileSync('图形样式.xlsx');
    const zip = await JSZip.loadAsync(data);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml').async('string');

    const cols = [];
    for (var n=3; n<=43; n++) cols.push(n<=26?String.fromCharCode(64+n):'A'+String.fromCharCode(64+n-26));

    var cells = {};
    var rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    var rm;
    while ((rm = rowRe.exec(sheetXml)) !== null) {
        var rn = parseInt(rm[1]);
        var cr = /<c r="([A-Z]+)(\d+)"[^>]*?s="(\d+)"/g;
        var cm;
        while ((cm = cr.exec(rm[2])) !== null) {
            var ci = cols.indexOf(cm[1]);
            if (ci>=0) cells[rn+','+ci] = parseInt(cm[3]);
        }
    }

    // BFS for yellow clusters
    var yv = {};
    function bfsY(r,c) {
        var q=[[r,c]], cl=[];
        yv[r+','+c]=true;
        while(q.length) {
            var cr=q[0][0], cc=q[0][1]; q.shift(); cl.push([cr,cc]);
            var dirs = [[0,1],[0,-1],[1,0],[-1,0]];
            for (var d=0; d<4; d++) {
                var nr=cr+dirs[d][0], nc=cc+dirs[d][1];
                var key=nr+','+nc;
                if (yv[key]) continue;
                if (cells[key]===1) { yv[key]=true; q.push([nr,nc]); }
            }
        }
        return cl;
    }

    var yellowClusters = [];
    for (var key in cells) {
        if (cells[key]!==1) continue;
        if (yv[key]) continue;
        var parts = key.split(',');
        yellowClusters.push(bfsY(parseInt(parts[0]), parseInt(parts[1])));
    }

    console.log('=== ' + yellowClusters.length + ' YELLOW CLUSTERS (game pieces) ===\n');

    var cleanShapes = [];
    yellowClusters.forEach(function(cl, i) {
        var rs=cl.map(function(d){return d[0]}), cs=cl.map(function(d){return d[1]});
        var minR=Math.min.apply(null,rs), maxR=Math.max.apply(null,rs);
        var minC=Math.min.apply(null,cs), maxC=Math.max.apply(null,cs);

        // Expanded view with borders
        var eMinR = Math.max(2, minR-1), eMaxR = Math.min(29, maxR+1);
        var eMinC = Math.max(0, minC-1), eMaxC = Math.min(40, maxC+1);

        var matrixStr = '';
        for (var r=eMinR; r<=eMaxR; r++) {
            var row='  |';
            for (var c=eMinC; c<=eMaxC; c++) {
                var s = cells[r+','+c];
                if (s===1) row += '##';
                else if (s!==undefined && s>=2 && s<=5) row += '--';
                else row += '  ';
            }
            matrixStr += row + '|\n';
        }

        // Pure shape
        var sh = maxR-minR+1, sw = maxC-minC+1;
        var smat = [];
        for (r=0; r<sh; r++) { smat[r]=[]; for (c=0; c<sw; c++) smat[r][c]=0; }
        cl.forEach(function(d){smat[d[0]-minR][d[1]-minC]=1});

        // Trim
        var sR=0, eR=sh-1, sC=0, eC=sw-1;
        while(sR<sh&&smat[sR].every(function(v){return v===0})) sR++;
        while(eR>=0&&smat[eR].every(function(v){return v===0})) eR--;
        while(sC<sw&&smat.every(function(r){return r[sC]===0})) sC++;
        while(eC>=0&&smat.every(function(r){return r[eC]===0})) eC--;

        var tH=eR-sR+1, tW=eC-sC+1;
        var tm = [];
        for (r=0; r<tH; r++) { tm[r]=[]; for (c=0; c<tW; c++) tm[r][c]=0; }
        for (r=sR; r<=eR; r++) for (c=sC; c<=eC; c++) if(smat[r][c]) tm[r-sR][c-sC]=1;

        console.log('Piece ' + i + ': ' + cl.length + ' cells, ' + tW + 'x' + tH);
        console.log('  With surrounding border:');
        console.log(matrixStr);
        console.log('  Pure shape:');
        tm.forEach(function(row){
            console.log('  |' + row.map(function(v){return v?'##':'  '}).join('') + '|');
        });
        console.log('');

        cleanShapes.push({id:i, size:cl.length, w:tW, h:tH, matrix:tm});
    });

    fs.writeFileSync('clean_shapes.json', JSON.stringify(cleanShapes, null, 2));
    console.log('Saved ' + cleanShapes.length + ' clean shapes');
}
main().catch(function(e){console.error(e)});
