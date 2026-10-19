'use strict';

(function () {
  var photos = [
    { id: 'garden', title: '花间来信', src: 'assets/garden.jpg', alt: '花园主题婚纱灵感影像，AI 生成，非真实客片' },
    { id: 'coast', title: '与海相拥', src: 'assets/coast.jpg', alt: '海岸主题婚纱灵感影像，AI 生成，非真实客片' }
  ];
  var filters = Array.from(document.querySelectorAll('[data-filter]'));
  var stories = Array.from(document.querySelectorAll('[data-style]'));
  var grid = document.querySelector('.gallery-grid');
  var status = document.getElementById('filter-status');
  var lightbox = document.getElementById('lightbox');
  var closeButton = document.querySelector('.close-button');
  var image = document.getElementById('preview-image');
  var title = document.getElementById('preview-title');
  var position = document.getElementById('preview-position');
  var previous = document.getElementById('previous-photo');
  var next = document.getElementById('next-photo');
  var selected = 0;
  var opener = null;
  var background = [document.querySelector('.app-header'), document.querySelector('main'), document.querySelector('.app-footer')];

  filters.forEach(function (button) {
    button.addEventListener('click', function () {
      var filter = button.dataset.filter;
      filters.forEach(function (item) {
        var active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      var count = 0;
      stories.forEach(function (story) {
        story.hidden = filter !== 'all' && story.dataset.style !== filter;
        if (!story.hidden) count += 1;
      });
      grid.classList.toggle('is-filtered', filter !== 'all');
      status.textContent = filter === 'all' ? '显示全部 ' + count + ' 幅灵感影像' : '显示' + button.textContent.trim() + '风格，' + count + ' 幅灵感影像';
    });
  });

  function showPhoto(index) {
    selected = (index + photos.length) % photos.length;
    var photo = photos[selected];
    image.src = photo.src;
    image.alt = photo.alt;
    title.textContent = photo.title;
    position.textContent = (selected + 1) + ' / ' + photos.length;
  }

  function openPreview(id, button) {
    var index = photos.findIndex(function (photo) { return photo.id === id; });
    if (index < 0) return;
    opener = button;
    showPhoto(index);
    lightbox.hidden = false;
    document.body.classList.add('preview-open');
    background.forEach(function (element) {
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
    });
    closeButton.focus();
  }

  function closePreview() {
    if (lightbox.hidden) return;
    lightbox.hidden = true;
    document.body.classList.remove('preview-open');
    background.forEach(function (element) {
      element.removeAttribute('inert');
      element.removeAttribute('aria-hidden');
    });
    if (opener && document.contains(opener)) opener.focus();
  }

  document.querySelectorAll('[data-preview]').forEach(function (button) {
    button.addEventListener('click', function () { openPreview(button.dataset.preview, button); });
  });
  closeButton.addEventListener('click', closePreview);
  previous.addEventListener('click', function () { showPhoto(selected - 1); });
  next.addEventListener('click', function () { showPhoto(selected + 1); });
  lightbox.addEventListener('click', function (event) { if (event.target === lightbox) closePreview(); });
  document.addEventListener('keydown', function (event) {
    if (lightbox.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePreview();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showPhoto(selected + (event.key === 'ArrowLeft' ? -1 : 1));
    } else if (event.key === 'Tab') {
      var controls = [closeButton, previous, next];
      var current = controls.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        next.focus();
      } else if (!event.shiftKey && (current === controls.length - 1 || current === -1)) {
        event.preventDefault();
        closeButton.focus();
      }
    }
  });
}());
