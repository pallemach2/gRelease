#!/usr/bin/env node

const childProcess = require('child_process');
const readline = require('readline');
const fs = require('fs');
const chalk = require('chalk');
const BufferList = require('bl');
const {
  exit
} = require('process');
const editJsonFile = require("edit-json-file");

let [, , ...args] = process.argv;
const pkg = fs.readFileSync(`${__dirname}/package.json`, 'utf8');
const package = JSON.parse(pkg);
let loadedFile = fs.readFileSync('./.grelease', 'utf8');
const config = JSON.parse(loadedFile);
let releaseBranch = '';

async function execute(command, ags) {
  const child = childProcess.spawn(command, ags);
  const stdout = child.stdout ? new BufferList() : '';
  const stderr = child.stderr ? new BufferList() : '';

  if (child.stdout) {
    child.stdout.on('data', data => {
      stdout.append(data);
    })
  }

  if (child.stderr) {
    child.stderr.on('data', data => {
      stderr.append(data);
    })
  }

  const promise = new Promise((resolve, reject) => {
    child.on('error', reject);

    child.on('exit', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const err = new Error(`child exited with code ${code}`)
        err.code = code;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err)
      }
    })
  })

  promise.child = child;

  return promise
}

async function checkCleanWorkingTree() {
  console.log(chalk.green('- Checking local repository for uncommited changes ...'));
  let res = await execute('git', ['status']);

  if (!res.toString().includes('nothing to commit, working tree clean')) {
    throw new Error('Working tree is not clean. Please commit and push your changes.')
  }
}

async function deleteLocalTag(tag) {
  await execute("git", ["tag", "-d", tag]);
}

async function pullRemote() {
  console.log(chalk.green('- Pulling from remote origin'));

  await execute('git', ['fetch']);
  await execute('git', ['pull', 'origin', '-a']);
}

async function readLocalTags() {
  console.log(chalk.green('- Deleting local tags'));

  const output = await execute("git", ["tag", "-l"]);

  let tags = output.toString().split(/(?:\r\n|\r|\n)/g);
  for (let tag of tags) {
    if (tag !== '') {
      await deleteLocalTag(tag);
    }
  }
}

async function checkNewTag(tag) {
  if (tag !== '') {
    const output = await execute("git", ["tag", "-l"]);
    let tags = output.toString().split(/(?:\r\n|\r|\n)/g);


    return !tags.includes(tag);
  } else {
    return false;
  }
}

async function readNewTag(newAttempt = false) {
  return new Promise(async (resolve, _) => {
    const output = await execute("git", ["tag", "-l"]);
    let tags = output.toString().split(/(?:\r\n|\r|\n)/g);
    tags.splice(tags.length - 1, 1);

    let latestRelease = '---'
    if (tags.length > 0) {
      latestRelease = tags[tags.length - 1]
    }

    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(newAttempt ? 'Version already exists. New version? ' : `Which version do you want to release? (Last release: ${latestRelease}) `, async (tag) => {
      if (await checkNewTag(tag)) {
        resolve(tag);
        rl.close();
      } else {
        rl.close();
        resolve(await readNewTag(true));
      }
    });
  });
}

async function checkDevBranch() {
  return new Promise(async (resolve, _) => {
    let currentBranch = (await execute('git', ['symbolic-ref', 'HEAD'])).toString().replace('refs/heads/', '').replace('\n', '');

    if (currentBranch !== config.devBranch && currentBranch !== releaseBranch && config.masterBranch !== currentBranch) {
      console.log(`You are not in the development branch ('${config.devBranch}'). You are in '${currentBranch}'.`);

      let rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question("Do you want to checkout the development branch and merge the current branch? (y/n) ", async (answer) => {
        if (answer === 'y') {
          await execute('git', ['checkout', config.devBranch]);
          await execute('git', ['pull']);
          await execute('git', ['merge', '--no-ff', currentBranch]);

          resolve();
          rl.close();
        } else {
          console.log('Okay, then I will stop here.');
          exit(0);
        }
      });
    } else {
      resolve();
    }
  });
}

async function doManualChanges() {
  return new Promise((resolve, _) => {
    let rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("You can apply changes to the files now. Press Enter when you are ready to release ... ", async (tag) => {
      resolve();
      rl.close();
    });
  })
}

async function switchToReleaseBranch() {
  console.log(chalk.green(`- Checking out to release branch ('${releaseBranch}') ... `));

  if (releaseBranch === '') throw new Error('Releasebranch name can not be empty.');

  let branches = (await execute('git', ['branch', '-l'])).toString().replace('*', '').replace(/^\s+|\s+$/gm, '').split(/(?:\r\n|\r|\n)/g);

  if (branches.includes(releaseBranch)) {
    await execute('git', ['checkout', releaseBranch]);
  } else {
    await execute('git', ['checkout', '-b', releaseBranch]);
  }

  console.log(chalk.green(`- Merging '${config.devBranch}' into '${releaseBranch}' ...`));
  await execute('git', ['merge', '--no-ff', config.devBranch]);
}

async function bumpPackageVersion(tag) {
  console.log(chalk.green('- Bumping version ...'));
  for (let file of config.packages) {
    let package = editJsonFile(file);
    package.set('version', tag);
    package.save();
  }

  await doManualChanges();

  console.log(chalk.green('- Commiting new version ...'));
  await execute('git', ['add', '.']);
  await execute('git', ['commit', '-am', `Bump version to ${tag}.`]);

  console.log(chalk.green('- Pushing new version ...'));
  await execute('git', ['push', '--set-upstream', 'origin', releaseBranch]);
}

async function mergeReleaseInMaster() {
  console.log(chalk.green(`- Merging ${releaseBranch} into master ...`));

  await execute('git', ['checkout', config.masterBranch]);
  await execute('git', ['fetch']);
  await execute('git', ['pull']);
  await execute('git', ['merge', '--no-ff', releaseBranch]);
  await execute('git', ['push']);
}

async function createTag(tag) {
  console.log(chalk.green(`- Tagging the release ...`));

  await execute('git', ['tag', '-a', tag, '-m', `Release of ${tag}`]);
  await execute('git', ['push', 'origin', tag]);
}

async function switchToDevelopBranch() {
  console.log(chalk.green('- Switching back to development branch ...'));

  await execute('git', ['checkout', config.devBranch]);
  await pullRemote();

  console.log(chalk.green(`- Merging '${config.masterBranch}' into '${config.devBranch}' ... \n`));

  await execute('git', ['merge', '--no-ff', `origin/${config.masterBranch}`]);
  await execute('git', ['push']);
}

async function main() {
  try {
    process.stdout.write('\033c');
    if (args.includes('-v')) {
      console.log(package.version);
      exit(0);
    }

    await execute('clear');
    console.log(chalk.bgGreen(`##### Welcome to gRelease! (${package.version}) ##### \n`));

    await checkCleanWorkingTree();
    await readLocalTags();
    await pullRemote();
    let newTag = await readNewTag();
    releaseBranch = `release/${newTag}`;
    await checkDevBranch();
    await switchToReleaseBranch();
    await bumpPackageVersion(newTag);
    await mergeReleaseInMaster();
    await createTag(newTag);
    await switchToDevelopBranch();

    console.log(chalk.bgGreen(`##### Release ${newTag} is ready. ##### \n`));
  } catch (e) {
    console.log(chalk.bgRed('ERROR'));
    console.log(chalk.bgRed(e.message));

    if (args.includes('--verbose')) {
      console.log(e);

      if (e.stdout) console.log(e.stdout.toString());
      if (e.stderr) console.log(e.stderr.toString());
    }
  }
}

main();