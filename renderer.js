// File: renderer.js
const { ipcRenderer } = require('electron');
const showdown = require('showdown');


// DOM Elements
const sidebarEl = document.getElementById('sidebar');
const notesListEl = document.getElementById('notesList');
const editorEl = document.getElementById('editor');
const previewEl = document.getElementById('preview');
const noteTitleEl = document.getElementById('noteTitle');
const saveBtn = document.getElementById('saveBtn');
const newNoteBtn = document.getElementById('newNoteBtn');
const recordBtn = document.getElementById('recordBtn');
const recordingControlsEl = document.getElementById('recordingControls');
const startRecordingBtn = document.getElementById('startRecordingBtn');
const stopRecordingBtn = document.getElementById('stopRecordingBtn');
const closeRecordingBtn = document.getElementById('closeRecordingBtn');
const captureSystemEl = document.getElementById('captureSystem');
const captureMicEl = document.getElementById('captureMic');
const recordingStatusEl = document.getElementById('recordingStatus');
const recordingTimerEl = document.getElementById('recordingTimer');
const searchNotesEl = document.getElementById('searchNotes');

// State
let currentNote = {
  path: null,
  title: 'Untitled Note',
  content: ''
};
let notes = [];
let isRecording = false;
let recordingInterval = null;
let recordingStartTime = 0;
let isPreviewMode = false;
let mediaRecorder = null;
let audioChunks = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadNotes();
  setupEventListeners();
  createNewNote();
  
  // Disable system audio checkbox
  captureSystemEl.disabled = true;
  captureSystemEl.parentElement.classList.add('disabled');
});

// Load notes from the main process
function loadNotes() {
  ipcRenderer.send('get-notes');
}

// Set up event listeners
function setupEventListeners() {
  // Note management
  saveBtn.addEventListener('click', saveCurrentNote);
  newNoteBtn.addEventListener('click', createNewNote);
  
  // Add global keyboard shortcut for Ctrl+S
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentNote();
    }
  });
  
  // Editor functionality
  editorEl.addEventListener('input', () => {
    currentNote.content = editorEl.value;
    updatePreview();
  });
  
  noteTitleEl.addEventListener('input', () => {
    currentNote.title = noteTitleEl.value;
  });
  
  // Real-time Markdown formatting with syntax highlighting
  editorEl.addEventListener('keydown', handleEditorKeydown);
  
  // Recording
  recordBtn.addEventListener('click', toggleRecordingPanel);
  startRecordingBtn.addEventListener('click', startRecording);
  stopRecordingBtn.addEventListener('click', stopRecording);
  closeRecordingBtn.addEventListener('click', closeRecordingPanel);
  
  // Search
  searchNotesEl.addEventListener('input', filterNotes);
  
  // IPC events
  ipcRenderer.on('notes-list', (event, notesList) => {
    notes = notesList.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    renderNotesList();
  });
  
  ipcRenderer.on('note-saved', (event, result) => {
    if (result.success) {
      currentNote.path = result.path;
      loadNotes(); // Refresh notes list
    } else {
      alert('Failed to save note: ' + result.error);
    }
  });
  
  ipcRenderer.on('note-loaded', (event, result) => {
    if (result.success) {
      currentNote.content = result.content;
      editorEl.value = currentNote.content;
      updatePreview();
    } else {
      alert('Failed to load note: ' + result.error);
    }
  });
  
  ipcRenderer.on('note-deleted', (event, result) => {
    if (result.success) {
      loadNotes(); // Refresh notes list
      createNewNote(); // Create a new note since we deleted the current one
    } else {
      alert('Failed to delete note: ' + result.error);
    }
  });
  
  ipcRenderer.on('recording-started', (event, result) => {
    if (result.success) {
      isRecording = true;
      startRecordingBtn.classList.add('hidden');
      stopRecordingBtn.classList.remove('hidden');
      recordingStatusEl.classList.remove('hidden');
      recordingStatusEl.classList.add('recording-active');
      recordingStatusEl.textContent = 'Recording...';
      
      // Start recording timer
      recordingStartTime = Date.now();
      recordingInterval = setInterval(updateRecordingTimer, 1000);
    } else {
      alert('Failed to start recording: ' + result.error);
    }
  });
  
  // New event handler for processing status updates
  ipcRenderer.on('processing-audio', (event, result) => {
    recordingStatusEl.classList.remove('hidden');
    recordingStatusEl.textContent = result.status;
  });
  
  ipcRenderer.on('transcription-complete', (event, result) => {
    stopRecordingUI();
    
    if (result.success) {
      // Add transcription to note
      const timestamp = new Date().toLocaleTimeString();
      const transcription = `\n\n## Transcription (${timestamp})\n\n${result.text}\n`;
      editorEl.value += transcription;
      currentNote.content = editorEl.value;
      
      // Update the note title to current date and time
      const now = new Date();
      const formattedDate = now.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
      const formattedTime = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const newTitle = `Notes ${formattedDate} ${formattedTime}`;
      
      currentNote.title = newTitle;
      noteTitleEl.value = newTitle;
      
      updatePreview();
    } else {
      alert('Failed to transcribe audio: ' + result.error);
    }
  });
}

// Note Management
function createNewNote() {
  currentNote = {
    path: null,
    title: 'Untitled Note',
    content: ''
  };
  
  noteTitleEl.value = currentNote.title;
  editorEl.value = currentNote.content;
  updatePreview();
  
  // Remove active state from all notes
  const noteItems = document.querySelectorAll('.note-item');
  noteItems.forEach(item => item.classList.remove('active'));
}

function saveCurrentNote() {
  if (!currentNote.title.trim()) {
    currentNote.title = 'Untitled Note';
    noteTitleEl.value = currentNote.title;
  }
  
  ipcRenderer.send('save-note', {
    title: currentNote.title,
    content: currentNote.content
  });
}

function deleteNote(notePath, event) {
  // Stop event propagation to prevent note selection
  if (event) {
    event.stopPropagation();
  }
  
  if (confirm('Are you sure you want to delete this note? This action cannot be undone.')) {
    ipcRenderer.send('delete-note', notePath);
  }
}

function loadNote(notePath) {
  ipcRenderer.send('load-note', notePath);
  
  // Extract filename without extension for title
  const pathParts = notePath.split(/[/\\]/);
  const fileName = pathParts[pathParts.length - 1];
  const title = fileName.replace(/\.md$/, '').replace(/_/g, ' ');
  
  currentNote.path = notePath;
  currentNote.title = title;
  noteTitleEl.value = currentNote.title;
  
  // Set active state on selected note
  const noteItems = document.querySelectorAll('.note-item');
  noteItems.forEach(item => {
    if (item.dataset.path === notePath) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function renderNotesList() {
  notesListEl.innerHTML = '';
  
  if (notes.length === 0) {
    notesListEl.innerHTML = '<div class="text-gray-500 text-center mt-4">No notes yet</div>';
    return;
  }
  
  notes.forEach(note => {
    const noteItem = document.createElement('div');
    noteItem.className = 'note-item';
    noteItem.dataset.path = note.path;
    
    // Check if this is the current note and add active class
    if (currentNote.path === note.path) {
      noteItem.classList.add('active');
    }
    
    // Extract filename without extension
    const pathParts = note.path.split(/[/\\]/);
    const fileName = pathParts[pathParts.length - 1];
    const title = fileName.replace(/\.md$/, '').replace(/_/g, ' ');
    
    const lastModified = new Date(note.lastModified).toLocaleString();
    
    noteItem.innerHTML = `
      <div class="note-content">
        <div class="note-title">${title}</div>
        <div class="note-date">${lastModified}</div>
      </div>
      <button class="delete-note-btn" title="Delete note">&times;</button>
    `;
    
    noteItem.addEventListener('click', () => {
      loadNote(note.path);
    });
    
    // Add event listener for delete button
    const deleteBtn = noteItem.querySelector('.delete-note-btn');
    deleteBtn.addEventListener('click', (event) => {
      deleteNote(note.path, event);
    });
    
    notesListEl.appendChild(noteItem);
  });
}

function filterNotes() {
  const searchTerm = searchNotesEl.value.toLowerCase();
  const noteItems = document.querySelectorAll('.note-item');
  
  noteItems.forEach(item => {
    const noteTitle = item.querySelector('.note-title').textContent.toLowerCase();
    if (noteTitle.includes(searchTerm)) {
      item.style.display = '';
    } else {
      item.style.display = 'none';
    }
  });
}

// Editor functionality
function handleEditorKeydown(e) {
  // Auto-complete markdown syntax
  if (e.key === '#') {
    // Let's add spacing after # for headers
    setTimeout(() => {
      const curPos = editorEl.selectionStart;
      const text = editorEl.value;
      const beforeCursor = text.substring(0, curPos);
      
      // If we're at the start of a line and typed #, add a space
      if (beforeCursor.match(/^#+ *$/) || beforeCursor.match(/\n#+ *$/)) {
        editorEl.value = text.substring(0, curPos) + ' ' + text.substring(curPos);
        editorEl.selectionStart = editorEl.selectionEnd = curPos + 1;
        updatePreview();
      }
    }, 0);
  }
}

function updatePreview() {
  // Initialize Showdown converter with ALL the options
  const converter = new showdown.Converter({
    tables: true,
    tasklists: true,
    strikethrough: true, 
    simplifiedAutoLink: true,
    openLinksInNewWindow: true,
    emoji: true,
    underline: true,
    parseImgDimensions: true,
    smartIndentationFix: true,
    ghCodeBlocks: true,
    splitAdjacentBlockquotes: true
  });
  
  // Set basic options
  converter.setOption('simpleLineBreaks', true);
  converter.setOption('headerLevelStart', 1);
  converter.setOption('encodeEmails', true);
  
  // Convert markdown to HTML
  const html = converter.makeHtml(currentNote.content);
  
  // Update the preview
  previewEl.innerHTML = html;
}

// Recording functionality
function toggleRecordingPanel() {
  if (recordingControlsEl.classList.contains('hidden')) {
    recordingControlsEl.classList.remove('hidden');
  } else {
    recordingControlsEl.classList.add('hidden');
  }
}

function closeRecordingPanel() {
  recordingControlsEl.classList.add('hidden');
}

async function startRecording() {
  const captureMic = captureMicEl.checked;
  
  // System audio is disabled, so we only check for mic
  if (!captureMic) {
    alert('Please select microphone to record.');
    return;
  }

  let tracks = [];

  try {
    if (captureMic) {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      tracks.push(...micStream.getAudioTracks());
    }

    if (tracks.length === 0) {
      alert('No audio tracks available.');
      return;
    }

    const mixedStream = new MediaStream(tracks);
    audioChunks = [];

    mediaRecorder = new MediaRecorder(mixedStream, { mimeType: 'audio/webm;codecs=opus' });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      const reader = new FileReader();

      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64data = reader.result.split(',')[1];
        ipcRenderer.send('stop-recording', { audioBlob: base64data });
      };

      mediaRecorder.stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start(1000);

    ipcRenderer.send('start-recording', { captureMic });
  } catch (err) {
    alert('Error accessing media: ' + err.message);
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return;
  }
  
  // Change the button text to indicate processing
  stopRecordingBtn.textContent = 'Processing...';
  
  // Update UI to show we're processing
  recordingStatusEl.textContent = 'Processing audio...';
  
  // Define what happens when recording stops
  mediaRecorder.onstop();
  
  // Stop the recording
  mediaRecorder.stop();
}

function stopRecordingUI() {
  isRecording = false;
  startRecordingBtn.classList.remove('hidden');
  stopRecordingBtn.classList.add('hidden');
  stopRecordingBtn.textContent = 'Stop Recording'; // Reset button text
  recordingStatusEl.classList.add('hidden');
  recordingStatusEl.classList.remove('recording-active');
  
  clearInterval(recordingInterval);
}

function updateRecordingTimer() {
  const elapsedSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
  const seconds = (elapsedSeconds % 60).toString().padStart(2, '0');
  recordingTimerEl.textContent = `${minutes}:${seconds}`;
}