const nextBtn = document.getElementById('nextBtn');
const skipBtn = document.getElementById('skipBtn');

function goToQuestionFlow() {
  window.location.href = 'onboarding-screen-4.html';
}

nextBtn?.addEventListener('click', () => {
  window.location.href = 'onboarding-screen-2.html';
});
skipBtn?.addEventListener('click', goToQuestionFlow);
