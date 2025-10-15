const o = document.getElementById('out');
document.getElementById('btn').addEventListener('click', () => {
  o.textContent = 'Button clicked at ' + new Date().toISOString();
});
