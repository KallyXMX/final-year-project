const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Applicant documents live OUTSIDE the public folder and are only served through an
// authorised route (owner or admin) - Requirement 4.8 "prevent unauthorized access".
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'private_uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword', 'application/octet-stream'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + unique + path.extname(file.originalname).toLowerCase());
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED[ext] && ALLOWED[ext].includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only .pdf, .doc, and .docx files are allowed.'), false);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter
});

module.exports = upload;
module.exports.uploadDir = uploadDir;
