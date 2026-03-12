(function () {
  async function safeJsonFetch(url, options) {
    var response = await fetch(url, options);
    if (!response.ok) {
      throw new Error("Request failed with status " + response.status);
    }
    return response.json();
  }

  function getQueryParam(name, fallback) {
    var params = new URLSearchParams(window.location.search);
    return params.get(name) || fallback;
  }

  window.ApiUtils = {
    getQueryParam: getQueryParam,
    safeJsonFetch: safeJsonFetch
  };
}());
