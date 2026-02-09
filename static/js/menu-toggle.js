(() => {
  document.documentElement.classList.add('js');
  const toggle = document.querySelector('.header__toggle');
  const nav = document.querySelector('.header__nav');
  if (!toggle || !nav) {
    return;
  }
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    nav.classList.toggle('header__nav--open', !expanded);
  });
})();
