const requiredMajor = 24;
const minimum = [24, 14, 0];
const version = process.versions.node.split('.').map(Number);
const [major, minor, patch] = version;
const tooOld = major < minimum[0] || (major === minimum[0] && (minor < minimum[1] || (minor === minimum[1] && patch < minimum[2])));

if (major !== requiredMajor || tooOld) {
  console.error(`\nRiftCoach Windows dev expects Node.js >=24.14 <25. Current: ${process.versions.node}`);
  console.error('Install Node 24 LTS/current, then rerun: pnpm install');
  console.error('With nvm-windows, for example: nvm install 24.14.1 && nvm use 24.14.1\n');
  process.exit(1);
}
