const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const mime = require('mime-types');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;
const sslPort = process.env.SSL_PORT || 443;

// --- Konfigurasi Supabase ---
// Disarankan untuk menyimpannya di Environment Variables (process.env)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://evcfckqcgeucugmkqbef.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_1PUlVZ3zSMyVA0r-tWUOSw_1byEaXMq';
const BUCKET_NAME = process.env.SUPABASE_BUCKET || 'uploads'; // Nama bucket di Supabase Storage

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.use(fileUpload());

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

/**
 * Helper to determine the request's protocol considering proxies
 */
function getRequestProtocol(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  if (forwarded) return forwarded.split(',')[0].trim();
  if (req.secure) return 'https';
  return req.protocol || 'http';
}

/**
 * Generate a short mixed ID (alphanumeric) using crypto
 */
function generateId(length = 6) {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let id = '';
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

/**
 * Public file proxy endpoint:
 * Mengambil file langsung dari Supabase Storage dan mengembalikannya ke client.
 */
app.get('/files/*', async (req, res) => {
  const requestedPath = req.params[0];
  if (!requestedPath) return res.status(400).send('Missing file path');

  // Bersihkan path jika ada prefix "uploads/"
  const filePath = requestedPath.replace(/^uploads\//, '');

  try {
    // Download file dari Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(filePath);

    if (error || !data) {
      console.error('Error fetching file from Supabase:', error);
      return res.status(404).send('File not found on Supabase Storage');
    }

    // Convert Blob/Stream ke Buffer
    const arrayBuffer = await data.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType = mime.lookup(filePath) || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    return res.send(buffer);

  } catch (error) {
    console.error('Error proxying file:', error.message || error);
    return res.status(500).send('Error fetching file');
  }
});

app.post('/uploadfile', async (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).send('No files were uploaded.');
  }

  let uploadedFile = req.files.file;
  const originalName = uploadedFile.name || 'file';
  const origExt = path.extname(originalName);

  let extension;
  if (origExt) {
    extension = origExt.replace(/^\./, '');
  } else {
    const mimeType = uploadedFile.mimetype || mime.lookup(originalName) || 'application/octet-stream';
    extension = mime.extension(mimeType) || 'bin';
  }

  let id = generateId(6);
  let fileName = origExt ? `${id}${origExt}` : `${id}.${extension}`;
  
  // Tipe MIME file
  const fileMime = uploadedFile.mimetype || mime.lookup(fileName) || 'application/octet-stream';

  try {
    // Upload ke Supabase Storage
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(fileName, uploadedFile.data, {
        contentType: fileMime,
        upsert: true
      });

    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).send('Gagal mengunggah file ke Supabase.');
    }

    const protocol = getRequestProtocol(req);
    const baseWebUrl = process.env.BASE_URL || `${protocol}://${req.get('host')}`;
    const rawUrl = `${baseWebUrl}/files/${fileName}`;

    // Render halaman sukses
    res.send(`
   <!DOCTYPE html>
<html lang="id" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unggahan Berhasil</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="icon" type="image/x-icon" href="https://raw.githubusercontent.com/upload-file-lab/fileupload7/main/uploads/1766330286639.jpeg?format=png&name=900x900">
    
    <script>
        tailwind.config = {
            darkMode: 'class',
            theme: { extend: {} }
        }
    </script>
    
    <style>
        body.dark-mode { background-color: #000000; color: #ffffff; transition: all 0.3s ease-in-out; }
        body.light-mode { background-color: #ffffff; color: #000000; transition: all 0.3s ease-in-out; }
        .dark-card { background-color: #111111; border: 1px solid #333333; box-shadow: 0 10px 25px rgba(255, 255, 255, 0.05); color: #ffffff; }
        .light-card { background-color: #ffffff; border: 1px solid #e5e7eb; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05); color: #000000; }
        .card-glow { transition: all 0.3s ease-in-out; }
        .card-glow:hover { transform: translateY(-5px); box-shadow: 0 20px 30px rgba(0, 0, 0, 0.1); }
        .theme-toggle { position: fixed; top: 20px; right: 20px; z-index: 1000; }
        .toggle-btn { background: linear-gradient(135deg, #000000 0%, #333333 100%); color: white; border: 1px solid #444444; }
        .toggle-btn-light { background: linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%); color: black; border: 1px solid #d1d5db; }
        .url-container { border-radius: 0.75rem; overflow: hidden; transition: all 0.3s; }
        .dark-url-container { background-color: #1a1a1a; border: 1px solid #333333; }
        .light-url-container { background-color: #f9fafb; border: 1px solid #e5e7eb; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.5s ease-out; }
        .hidden { display: none; }
        .checkmark { width: 80px; height: 80px; border-radius: 50%; display: block; stroke-width: 3; stroke: #10b981; stroke-miterlimit: 10; box-shadow: inset 0px 0px 0px #10b981; animation: fill .4s ease-in-out .4s forwards, scale .3s ease-in-out .9s both; position: relative; margin: 0 auto; }
        .checkmark-dark { background-color: #222222; }
        .checkmark-light { background-color: #f3f4f6; }
        .checkmark__circle { stroke-dasharray: 166; stroke-dashoffset: 166; stroke-width: 3; stroke-miterlimit: 10; stroke: #10b981; fill: none; animation: stroke .6s cubic-bezier(0.65, 0, 0.45, 1) forwards; }
        .checkmark__check { transform-origin: 50% 50%; stroke-dasharray: 48; stroke-dashoffset: 48; animation: stroke .3s cubic-bezier(0.65, 0, 0.45, 1) .8s forwards; }
        @keyframes stroke { 100% { stroke-dashoffset: 0; } }
        @keyframes scale { 0%, 100% { transform: none; } 50% { transform: scale3d(1.1, 1.1, 1); } }
        @keyframes fill { 100% { box-shadow: inset 0px 0px 0px 40px rgba(16, 185, 129, 0.1); } }
    </style>
</head>
<body class="flex flex-col items-center justify-center min-h-screen p-4 dark-mode">
    <div class="theme-toggle">
        <button id="theme-toggle" type="button" class="p-3 rounded-full toggle-btn hover:opacity-90 transition duration-300 focus:outline-none focus:ring-2 focus:ring-gray-400">
            <svg id="theme-toggle-dark-icon" class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path></svg>
            <svg id="theme-toggle-light-icon" class="w-6 h-6 hidden" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>
        </button>
    </div>

    <div class="dark-card p-8 rounded-xl shadow-2xl w-full max-w-md card-glow fade-in">
        <div class="mb-6">
            <div id="success-checkmark" class="checkmark checkmark-dark">
                <svg class="checkmark__svg" viewBox="0 0 52 52">
                    <circle class="checkmark__circle" cx="26" cy="26" r="25" fill="none"/>
                    <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
            </div>
        </div>
        
        <h1 class="text-3xl font-extrabold text-center mb-4">Unggahan Berhasil!</h1>
        <div class="text-center mb-6 text-md">
            File Anda berhasil diunggah ke Supabase. Tautan langsung:
        </div>
        
        <div class="url-container dark-url-container mb-6 p-4">
            <a id="rawUrlLink" href="${rawUrl}" class="block break-words hover:opacity-80 transition duration-200 font-semibold text-lg" target="_blank" rel="noopener noreferrer">
                ${rawUrl}
            </a>
            <div class="mt-2 text-sm opacity-70">
                Klik untuk membuka di tab baru
            </div>
        </div>
        
        <div class="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <button onclick="copyUrl()" class="w-full sm:w-1/2 bg-gradient-to-r from-gray-800 to-gray-900 hover:from-gray-900 hover:to-black text-white font-bold py-3 px-4 rounded-full shadow-lg transform hover:scale-105 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-400">
                <div class="flex items-center justify-center">
                    <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                    Salin URL
                </div>
            </button>
            
            <a href="/" class="w-full sm:w-1/2 flex items-center justify-center bg-gradient-to-r from-gray-300 to-gray-400 hover:from-gray-400 hover:to-gray-500 text-gray-800 font-bold py-3 px-4 rounded-full shadow-lg transform hover:scale-105 transition duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-gray-400">
                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                Kembali
            </a>
        </div>  

    <div id="copy-success" class="fixed top-20 right-4 bg-green-500 text-white px-4 py-3 rounded-lg shadow-lg hidden fade-in z-50">
        URL berhasil disalin!
    </div>

    <script>
        const themeToggleBtn = document.getElementById('theme-toggle');
        const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
        const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');
        const body = document.body;
        const card = document.querySelector('.dark-card');
        const urlContainer = document.querySelector('.url-container');
        const successCheckmark = document.getElementById('success-checkmark');
        const copySuccess = document.getElementById('copy-success');
        
        const rawUrl = "${rawUrl}";
        const rawUrlLink = document.getElementById('rawUrlLink');
        rawUrlLink.href = rawUrl;
        rawUrlLink.textContent = rawUrl;

        function applyTheme(isDarkMode) {
            if (isDarkMode) {
                body.classList.remove('light-mode');
                body.classList.add('dark-mode');
                card.classList.remove('light-card');
                card.classList.add('dark-card');
                urlContainer.classList.remove('light-url-container');
                urlContainer.classList.add('dark-url-container');
                successCheckmark.classList.remove('checkmark-light');
                successCheckmark.classList.add('checkmark-dark');
                themeToggleBtn.classList.remove('toggle-btn-light');
                themeToggleBtn.classList.add('toggle-btn');
                themeToggleDarkIcon.classList.remove('hidden');
                themeToggleLightIcon.classList.add('hidden');
            } else {
                body.classList.add('light-mode');
                body.classList.remove('dark-mode');
                card.classList.remove('dark-card');
                card.classList.add('light-card');
                urlContainer.classList.remove('dark-url-container');
                urlContainer.classList.add('light-url-container');
                successCheckmark.classList.remove('checkmark-dark');
                successCheckmark.classList.add('checkmark-light');
                themeToggleBtn.classList.remove('toggle-btn');
                themeToggleBtn.classList.add('toggle-btn-light');
                themeToggleDarkIcon.classList.add('hidden');
                themeToggleLightIcon.classList.remove('hidden');
            }
        }

        if (localStorage.getItem('color-theme') === 'light') {
            applyTheme(false);
        } else {
            applyTheme(true);
        }

        themeToggleBtn.addEventListener('click', function() {
            const isDarkMode = body.classList.contains('dark-mode');
            if (isDarkMode) {
                localStorage.setItem('color-theme', 'light');
                applyTheme(false);
            } else {
                localStorage.setItem('color-theme', 'dark');
                applyTheme(true);
            }
        });

        function copyUrl() {
            const rawUrl = document.getElementById('rawUrlLink').href;
            navigator.clipboard.writeText(rawUrl).then(function() {
                copySuccess.classList.remove('hidden');
                copySuccess.classList.add('fade-in');
                setTimeout(() => {
                    copySuccess.classList.remove('fade-in');
                    setTimeout(() => { copySuccess.classList.add('hidden'); }, 300);
                }, 3000);
            });
        }
    </script>
</body>
</html>
`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file to Supabase.');
  }
});

// Server listener (SSL/HTTP)
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || './certs/privkey.pem';
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || './certs/fullchain.pem';
const enforceHttps = process.env.FORCE_HTTPS === 'true';

const hasSslFiles = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);

if (hasSslFiles) {
  const key = fs.readFileSync(SSL_KEY_PATH);
  const cert = fs.readFileSync(SSL_CERT_PATH);

  https.createServer({ key, cert }, app).listen(sslPort, () => {
    console.log(`HTTPS Server running at https://0.0.0.0:${sslPort}`);
  });

  http.createServer((req, res) => {
    const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
    res.writeHead(301, { Location: `https://${host}${req.url}` });
    res.end();
  }).listen(80, () => {
    console.log('HTTP -> HTTPS redirect server running on port 80');
  });
} else if (enforceHttps) {
  console.error('SSL files not found. Exiting.');
  process.exit(1);
} else {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}