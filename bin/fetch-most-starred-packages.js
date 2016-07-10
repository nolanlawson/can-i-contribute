#!/usr/bin/env node

var cheerio = require('cheerio')
var fetch = require('node-fetch')
var denodeify = require('denodeify')
var writeFile = denodeify(require('fs').writeFile)

var urls = [
  'https://www.npmjs.com/browse/star',
  'https://www.npmjs.com/browse/star?offset=36',
  'https://www.npmjs.com/browse/star?offset=72'
]

var packages = []

var chain = Promise.resolve()

urls.forEach(url => {
  chain = chain.then(() => {
    return fetch(url).then(resp => resp.text()).then(text => {
      var $ = cheerio.load(text)
      var nodes = $('.package-details h3 a')
      var i = -1;
      while (packages.length < 100 && i < nodes.length - 1) {
        packages.push($(nodes[++i]).text())
      }
    })
  })
})

chain.then(() => {
  return writeFile('topPackages.json', JSON.stringify(packages, null, '  '), 'utf-8')
}).catch(err => {
  console.log(err)
  console.log(err.stack)
  process.exit(1)
})