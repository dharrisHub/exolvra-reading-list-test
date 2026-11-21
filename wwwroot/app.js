(function () {
  'use strict';

  var FORMAT_VERSION = 1;

  var titleInput = document.getElementById('title-input');
  var authorInput = document.getElementById('author-input');
  var addButton = document.getElementById('add-button');
  var addFeedback = document.getElementById('add-feedback');
  var searchInput = document.getElementById('search-input');
  var clearButton = document.getElementById('clear-button');
  var refreshButton = document.getElementById('refresh-button');
  var listFeedback = document.getElementById('list-feedback');
  var countEl = document.getElementById('count');
  var listEl = document.getElementById('book-list');
  var emptyEl = document.getElementById('empty-message');
  var noResultsEl = document.getElementById('no-results');

  var books = [];
  var saving = false;
  var loading = false;
  var saveGeneration = 0;

  // Each book is stored as a stable JSON string: {"v":1,"title":"...","author":"..."}.
  function encodeBook(title, author) {
    return JSON.stringify({ v: FORMAT_VERSION, title: title, author: author });
  }

  function decodeBook(entry) {
    if (typeof entry !== 'string') {
      return { title: String(entry), author: '' };
    }
    try {
      var parsed = JSON.parse(entry);
      if (parsed && typeof parsed === 'object' && typeof parsed.title === 'string') {
        return { title: parsed.title, author: typeof parsed.author === 'string' ? parsed.author : '' };
      }
    } catch (e) {
      // Not a structured entry; treat the raw string as a title.
    }
    return { title: entry, author: '' };
  }

  function setFeedback(el, message, kind) {
    el.textContent = message || '';
    el.classList.remove('is-error', 'is-success', 'is-info');
    if (message && kind) {
      el.classList.add('is-' + kind);
    }
  }

  function plural(n) {
    return n + (n === 1 ? ' book' : ' books');
  }

  function normalize(s) {
    return s.toLocaleLowerCase();
  }

  function render() {
    var query = searchInput.value.trim();
    var q = normalize(query);
    var visible = q
      ? books.filter(function (b) {
          return normalize(b.title).indexOf(q) !== -1 || normalize(b.author).indexOf(q) !== -1;
        })
      : books;

    listEl.replaceChildren();
    visible.forEach(function (book) {
      var li = document.createElement('li');
      li.className = 'book';
      var title = document.createElement('span');
      title.className = 'book-title';
      title.textContent = book.title;
      li.appendChild(title);
      if (book.author) {
        var author = document.createElement('span');
        author.className = 'book-author';
        author.textContent = 'by ' + book.author;
        li.appendChild(author);
      }
      listEl.appendChild(li);
    });

    if (q) {
      countEl.textContent = 'Showing ' + visible.length + ' of ' + plural(books.length) + ' (total ' + books.length + ')';
    } else {
      countEl.textContent = 'Total: ' + plural(books.length);
    }

    emptyEl.hidden = books.length !== 0;
    if (q && visible.length === 0 && books.length > 0) {
      noResultsEl.textContent = 'No books match “' + query + '”. Try a different title or author, or use Clear search.';
      noResultsEl.hidden = false;
    } else {
      noResultsEl.textContent = '';
      noResultsEl.hidden = true;
    }
    listEl.hidden = visible.length === 0;
    clearButton.disabled = searchInput.value.length === 0;
  }

  function loadBooks() {
    if (loading) {
      return Promise.resolve();
    }
    loading = true;
    refreshButton.disabled = true;
    setFeedback(listFeedback, 'Loading books…', 'info');
    var startedAtSave = saveGeneration;
    var stale = false;
    return fetch('notes', { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function (data) {
        if (!Array.isArray(data)) {
          throw new Error('Unexpected response');
        }
        if (startedAtSave !== saveGeneration) {
          // A book was saved while this request was in flight; reload for a consistent view.
          stale = true;
          return;
        }
        books = data.map(decodeBook);
        setFeedback(listFeedback, '', null);
        render();
      })
      .catch(function () {
        setFeedback(listFeedback, 'Could not load books. Check the connection and use Refresh to try again.', 'error');
        render();
      })
      .then(function () {
        loading = false;
        refreshButton.disabled = false;
        if (stale) {
          return loadBooks();
        }
      });
  }

  function setSaving(value) {
    saving = value;
    addButton.disabled = value;
    addButton.setAttribute('aria-busy', value ? 'true' : 'false');
    addButton.textContent = value ? 'Saving…' : 'Add book';
    titleInput.readOnly = value;
    authorInput.readOnly = value;
  }

  function addBook() {
    if (saving) {
      return;
    }
    var title = titleInput.value.trim();
    var author = authorInput.value.trim();

    if (!title) {
      titleInput.setAttribute('aria-invalid', 'true');
      setFeedback(addFeedback, 'Enter a title before adding a book.', 'error');
      titleInput.focus();
      return;
    }
    titleInput.removeAttribute('aria-invalid');

    setSaving(true);
    setFeedback(addFeedback, 'Saving…', 'info');

    fetch('notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ text: encodeBook(title, author) })
    })
      .then(function (response) {
        if (response.status !== 201 && !response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        saveGeneration += 1;
        books.push({ title: title, author: author });
        titleInput.value = '';
        authorInput.value = '';
        render();
        setFeedback(addFeedback, 'Added “' + title + '”.', 'success');
      })
      .catch(function () {
        setFeedback(addFeedback, 'Could not save the book. Your input was kept; please try again.', 'error');
      })
      .then(function () {
        setSaving(false);
        titleInput.focus();
      });
  }

  function onEnter(event) {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      addBook();
    }
  }

  addButton.addEventListener('click', addBook);
  titleInput.addEventListener('keydown', onEnter);
  authorInput.addEventListener('keydown', onEnter);
  titleInput.addEventListener('input', function () {
    if (titleInput.value.trim()) {
      titleInput.removeAttribute('aria-invalid');
      if (addFeedback.classList.contains('is-error')) {
        setFeedback(addFeedback, '', null);
      }
    }
  });

  searchInput.addEventListener('input', render);
  searchInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
    }
  });
  clearButton.addEventListener('click', function () {
    searchInput.value = '';
    render();
    searchInput.focus();
  });
  refreshButton.addEventListener('click', function () {
    loadBooks();
  });

  render();
  loadBooks();
})();
