const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Serve public directory static files
app.use(express.static(path.join(__dirname, 'public')));

// Serve root directory static files (icons, manifest, etc.)
app.use(express.static(__dirname));

// Fallback to index.html for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
