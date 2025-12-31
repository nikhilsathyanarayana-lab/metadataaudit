const chartData = {
  datasets: [{
    label: 'My First Dataset',
    data: [300, 50, 100],
    backgroundColor: [
      'rgb(255, 99, 132)',
      'rgb(54, 162, 235)',
      'rgb(255, 205, 86)'
    ],
    hoverOffset: 4
  }]
};

new Chart(document.getElementById('subDonut'), {
  type: 'doughnut',
  data: chartData
});

new Chart(document.getElementById('subDonutFull'), {
  type: 'doughnut',
  data: chartData
});
