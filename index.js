var spawn = require('cross-spawn')
var denodeify = require('denodeify')
var rimraf = denodeify(require('rimraf'))
var mkdirp = denodeify(require('mkdirp'))
var fetch = require('node-fetch')
var packages = require('./topPackages')
var path = require('path')
var url = require('url')

function spawnAndRedirectConsole (cmd, args, opts) {
  console.log(cmd, args, {cwd: opts.cwd})
  return new Promise((resolve, reject) => {
    var child = spawn(cmd, args, opts)

    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(code)
      }
    })

    child.on('error', err => {
      console.error(err)
      console.error(err.stack)
    })

    child.stdout.on('data', data => console.log(data.toString('utf-8').replace(/\n$/, '')))
    child.stderr.on('data', data => console.error(data.toString('utf-8').replace(/\n$/, '')))
  })
}

rimraf('./workspace').then(() => {
  return mkdirp('./workspace')
}).then(() => {
  var chain = Promise.resolve()
  packages.forEach(pkg => {
    chain = chain.then(() => {
      return fetch(`http://registry.npmjs.org/${pkg}`).then(resp => resp.json()).then(json => {
        if (!json.repository) {
          console.error(`skipping package ${pkg} because no repository`)
          return
        }
        var repo = json.repository.url || json.repository
        repo = repo.replace('git+https', 'https')
        var gitPromise = spawnAndRedirectConsole(
          'git',
          ['clone', '--depth', '1', '--single-branch', '--branch', 'master', repo],
          {
            cwd: 'workspace',
            env: process.env
          })
        return gitPromise.then(() => {
          var paths = url.parse(repo).path.split('/')
          var dir = paths[paths.length - 1].replace(/.git$/, '')
          return spawnAndRedirectConsole('npm', ['install'], {
            cwd: path.join('workspace', dir),
            env: process.env
          }).then(() => {
            return spawnAndRedirectConsole('npm', ['test'], {
              cwd: path.join('workspace', dir),
              env: process.env
            })
          })
        })
      })
    })
  })
  return chain
}).catch(err => {
  console.error(err)
  console.error(err.stack)
  process.exit(1)
})