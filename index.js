var spawn = require('cross-spawn')
var denodeify = require('denodeify')
var rimraf = denodeify(require('rimraf'))
var mkdirp = denodeify(require('mkdirp'))
var fetch = require('node-fetch')
var packages = require('./topPackages')
var path = require('path')
var present = require('present')
var writeFile = denodeify(require('fs').writeFile)

var TIMEOUT = 300000 // timeout and fail after this many milliseconds

var IGNORE = [
  'npm',             // slow
  'pm2',             // fails
  'webpack',         // slow
  'yo',              // slow
  'gulp-sourcemaps', // slow
  'karma',           // slow
  'redis',           // requires redis?
  'mysql',           // requires mysql?
  'forever',         // ties up resources and doesn't delete them
  'mongoose'         // requires mongo
]

function spawnAndRedirectConsole (cmd, args, opts) {
  return new Promise((resolve, reject) => {
    var child = spawn(cmd, args, opts)
    var done = false

    child.on('close', code => {
      if (done) {
        return
      }
      done = true
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('rejected with code: ' + code))
      }
    })

    child.on('error', err => {
      console.error(err)
      console.error(err.stack)
    })

    child.stdout.on('data', data => console.log(data.toString('utf-8').replace(/\n$/, '')))
    child.stderr.on('data', data => console.error(data.toString('utf-8').replace(/\n$/, '')))

    setTimeout(() => {
      if (done) {
        return
      }
      done = true
      reject(new Error(`timed out after ${TIMEOUT}ms`))
      child.kill('SIGINT')
    }, TIMEOUT)
  })
}

function spawnCommand (cmd, args, opts) {
  console.log(cmd, args, {cwd: opts.cwd})
  var start = present()
  return spawnAndRedirectConsole(cmd, args, opts).then(() => {
    return {passed: true, time: present() - start}
  }).catch(err => {
    console.error(err)
    return {passed: false, time: present() - start}
  })
}

var testResults = []

rimraf('./workspace').then(() => {
  return mkdirp('./workspace')
}).then(() => {
  var chain = Promise.resolve()
  packages.forEach(pkg => {
    chain = chain.then(() => {
      var pkgResult = {name: pkg}
      testResults.push(pkgResult)
      if (IGNORE.indexOf(pkg) !== -1) {
        console.error(`skipping package ${pkg} because it takes too long or is faily`)
        pkgResult.skipped = true
        pkgResult.reason = 'excluded'
        return
      }
      return fetch(`http://registry.npmjs.org/${pkg}`).then(resp => resp.json()).then(json => {
        if (!json.repository) {
          console.error(`skipping package ${pkg} because no repository`)
          pkgResult.skipped = true
          pkgResult.reason = 'no repo'
          return
        }
        var repo = (json.repository.url || json.repository).replace('git+https', 'https')
        pkgResult.repo = repo
        var dir = path.join('workspace', pkg)
        var gitPromise = spawnCommand(
          'git',
          [ 'clone', '--depth', '1', '--single-branch', '--branch', 'master', repo, pkg ],
          {
            cwd: 'workspace',
            env: process.env
          })
        return gitPromise.then(res => {
          pkgResult.gitClonePassed = res.passed
          return spawnCommand('npm', ['install'], {
            cwd: dir,
            env: process.env
          }).then(res => {
            pkgResult.npmInstallPassed = res.passed
            pkgResult.npmInstallTime = res.time
            return spawnCommand('npm', ['test'], {
              cwd: dir,
              env: process.env
            })
          }).then(res => {
            pkgResult.npmTestPassed = res.passed
            pkgResult.npmTestTime = res.time
            console.log(JSON.stringify(testResults, null, '  '))
          }).then(() => {
            return rimraf(dir)
          })
        })
      })
    })
  })
  return chain.then(() => {
    return writeFile('results.json', JSON.stringify(testResults, null, '  '), 'utf-8')
  })
}).catch(err => {
  console.error(err)
  console.error(err.stack)
  process.exit(1)
})
