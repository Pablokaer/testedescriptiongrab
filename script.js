const counterValue = document.getElementById('counter-value');
const counterButton = document.getElementById('counter-button');

let count = 0;

counterButton.addEventListener('click', () => {
  count += 1;
  counterValue.textContent = count;
});
