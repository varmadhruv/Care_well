(() => {
  async function bootstrap() {
    try {
      if (window.CareWellRegistration) {
        const status = await window.CareWellRegistration.resumeRegistration();
        if (status?.registrationCompleted) {
          window.location.replace('dashboard.html');
          return;
        }
        const route = window.CareWellRegistration.getRouteForStep(status?.registrationStep || 1);
        if (route && route !== 'registration.html') {
          window.location.replace(route);
        }
        return;
      }

      window.location.replace('onboarding-screen-7.html');
    } catch (error) {
      window.location.replace('onboarding-screen-7.html');
    }
  }

  bootstrap();
})();
