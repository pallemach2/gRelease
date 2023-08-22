# gRelease
A simple git release helper.

Just create a ```.grelease```-file in your project-root directory and define the name of your master and dev branch and the relativ-path to your package.json.

Now you can install the package globally with ```npm i -g grelease``` and use it with the command ```grelease``` in your project folder. 
Alternatively you can use the script with ```npx grelease``` in your project folder without installing it first.

Example:
```
{
  "masterBranch": "master",
  "devBranch": "develop",
  "packages": ["./api/package.json", "./client/package.json"]
}
```
