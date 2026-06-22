import { createWriteStream } from 'node:fs';
import { execSync } from 'node:child_process';
execSync('cd dist && zip -r -q ../immersive-bilingual.zip . && cd ..');
console.log('zipped -> immersive-bilingual.zip');
