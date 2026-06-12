const fs = require('fs/promises');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', '..', 'data', 'osint_investigations');

const ensureDirectory = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

const saveInvestigation = async (seed, data) => {
  await ensureDirectory();
  const safeFilename = encodeURIComponent(seed) + '.json';
  const filePath = path.join(dataDir, safeFilename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
};

const getInvestigation = async (seed) => {
  await ensureDirectory();
  const safeFilename = encodeURIComponent(seed) + '.json';
  const filePath = path.join(dataDir, safeFilename);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

const listInvestigations = async () => {
  await ensureDirectory();
  try {
    const files = await fs.readdir(dataDir);
    const list = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(dataDir, file);
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        list.push({
          seed: parsed.seed,
          seedType: parsed.seedType,
          investigatedAt: parsed.investigatedAt,
          confidence: parsed.artifacts?.hypotheses?.hypotheses?.primary_hypothesis?.confidence || 0
        });
      }
    }
    return list;
  } catch (error) {
    return [];
  }
};

module.exports = {
  saveInvestigation,
  getInvestigation,
  listInvestigations
};
