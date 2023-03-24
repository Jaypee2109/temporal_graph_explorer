/**---------------------------------------------------------------------------------------------------------------------
 * Global Values
 *-------------------------------------------------------------------------------------------------------------------*/

//buffers
let bufferedMetrics = [];
let myCharts = new Map();

//buttons
const AddGraphButton = document.getElementById("addButtonField");
const AddGraphIcon = document.getElementById("addGraphIcon");

//sidebar
const sidebarToggle = document.getElementById("sidebarToggle");
let sidebarList = document.querySelector(".sidebar-content");
const parentContainer = document.getElementById("parent-container");

//chart layout
let childContainerCount = 0;

//popover bootstrap
const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]')
const popoverList = [...popoverTriggerList].map(popoverTriggerEl => new bootstrap.Popover(popoverTriggerEl))

/**---------------------------------------------------------------------------------------------------------------------
 * Callbacks
 *-------------------------------------------------------------------------------------------------------------------*/

AddGraphButton.addEventListener("click", loadModal);
AddGraphIcon.addEventListener("click", loadModal);

//request metric if URL contains configuration
$(document).one("ready", function () {

    const urlParams = new URLSearchParams(window.location.search);
    let dbName = urlParams.get("dbName");
    let metric = urlParams.get("metric");
    let predicate = urlParams.get("predicate");
    let timestamp1 = urlParams.get("timestamp1");
    let timestamp2 = urlParams.get("timestamp2");
    let filters = urlParams.get("filters");


    if (dbName && metric && predicate && timestamp1 && timestamp2 && filters) {

        let request = {
            dbName: dbName,
            metric: metric,
            predicate: predicate,
            timestamp1: timestamp1,
            timestamp2: timestamp2,
            filters: [filters]
        };

        addGraphToSidebar();
        addGraph(request);

    }
})

window.addEventListener('resize', function () {
    for (let chart of myCharts.values()) {
        chart.resize();
    }
})

sidebarToggle.addEventListener("click", function () {
    document.querySelector("body").classList.toggle("active");
    setTimeout(() => {
        for (let chart of myCharts.values()) {
            chart.resize();
        }
    }, 800)
});

$(document).on('click', "#calcGraph", function () {

    let filters = [];

    try {
        filters = document.querySelector("#vertices").value;
    } catch (e) {
        console.log("Virtual Select wasn't ready");
    }

    let request = {
        dbName: $("#graphSelector").val(),
        metric: getValues("#metric"),
        predicate: getValues("#predicateSelector"),
        timestamp1: getValues("#timestamp1"),
        timestamp2: getValues("#timestamp2"),
        filters: filters
    };

    addGraph(request);

});

$(document).on('change', '#predicateSelector', function () {
    let dropdown = $(this);

    let tsInput1 = $('#timestamp1');
    tsInput1.removeAttr('disabled');
    let tsInput2 = $('#timestamp2');
    tsInput2.removeAttr('disabled');

    switch (dropdown.val()) {
        case 'all':
            tsInput1.attr('disabled', 'disabled');
            tsInput2.attr('disabled', 'disabled');
            break;
        case 'asOf':
            tsInput2.attr('disabled', 'disabled');
            break;
    }
});

/**---------------------------------------------------------------------------------------------------------------------
 * Manage metrics
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Add meta information to sidebar after metric request.
 */
function addGraphToSidebar() {

    let graphs = $(".sidebar-content > li");
    //graph id
    let newId = 1;
    while (newId <= 4) {
        if (!document.getElementById(`plot${newId}`)) {
            break;
        }
        newId++;
    }

    let li = document.createElement("li");
    li.setAttribute("data-id", newId.toString());

    li.innerHTML = "<div class='row'><div class='col-10'>Graph " + newId +
        "</div><div class='col-2'><button class='delButton' " +
        "onclick='deleteGraph(this.parentElement.parentElement.parentElement)'>" +
        "<i class=\"fa-solid fa-trash-can\"></i></div></div>";

    let AddButtonLi = document.querySelector("#addGraphLi");
    sidebarList.insertBefore(li, AddButtonLi);

    if (graphs.length > 3) {
        AddButtonLi.classList.add("hide");
    }

}

/**
 * Delete chart with all references.
 *
 * @param graphLi the sidebar graph name element of the metric to be deleted
 */
function deleteGraph(graphLi) {
    let index = $(graphLi).index();
    let plotid = graphLi.getAttribute("data-id");

    //delete graph from sidebar
    graphLi.remove();

    //delete Echarts instance from chart buffer
    myCharts.get("plot" + plotid).dispose();
    myCharts.delete("plot" + plotid);

    //delete buffered data reference
    for (let metric of bufferedMetrics) {
        if (metric.plotIds.includes(Number(plotid))) {
            metric.plotIds = metric.plotIds.filter(function (e) {
                return e !== Number(plotid)
            });
            break;
        }
    }

    deleteGraphPlot(index);

    for (let chart of myCharts.values()) {
        chart.resize();
    }

    document.querySelector("#addGraphLi").classList.remove("hide");
}

/**---------------------------------------------------------------------------------------------------------------------
 * Chart configurations
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Open chart configuration window to select shown vertices.
 *
 * @param myConfig ECharts instance configuration
 */
function chartConfiguration(myConfig) {
    $("#chartConfiguration").modal("show");

    let vertex1Dropdown = document.querySelector("#vertex1Select");
    let vertex2Dropdown = document.querySelector("#vertex2Select");

    let bufferedIndex = getBufferedDataIndex(myConfig.myPlotId);
    let vertices = bufferedMetrics[bufferedIndex].vertices;

    let selectorOptions = getVirtualSelectOptions(vertices);

    VirtualSelect.init({
        ele: "#vertex1Select",
        search: true,
        disable: true,
        options: [],
        hideClearButton: true
    });

    vertex1Dropdown.setOptions(selectorOptions);
    vertex1Dropdown.setValue(myConfig.myVertices[0].id);

    let vertex2 = "";
    if (myConfig.myVertices[1] !== null) {
        vertex2 = myConfig.myVertices[1].id;
    }

    VirtualSelect.init({
        ele: "#vertex2Select",
        search: true,
        disable: true,
        options: [],
        emptyValue: ""
    });

    vertex2Dropdown.setOptions(selectorOptions);
    vertex2Dropdown.setValue(vertex2);

    $(document).one("click", "#calcChart", function () {
        let vertex1Selected = vertex1Dropdown.value;
        let vertex2Selected = vertex2Dropdown.value;


        if (vertex1Selected !== myConfig.myVertices[0].id || vertex2Selected !== vertex2) {

            if (vertex1Selected === vertex2Selected) {
                drawChart(vertex1Selected.toString(), "", myConfig.myPlotId);
            } else {
                drawChart(vertex1Selected.toString(), vertex2Selected.toString(), myConfig.myPlotId);
            }
        }

    })
}

/**
 * Configure moving average.
 *
 * @param myConfig Echarts instance configuration
 */
function movingAverageCall(myConfig) {

    $("#movingAverage").modal("show");

    let dataCopy = myConfig.myData;
    let listOfAllVertices = []

    for (let i = 0; i < myConfig.myVertices.length && myConfig.myVertices[i] !== null; i++) {

        let listOfMetricValue = [];

        for (let k = 0; k < dataCopy.length; k++) {
            if (dataCopy[k].vertex === myConfig.myVertices[i].id) {
                listOfMetricValue.push(dataCopy[k]);
            }
        }

        if (listOfMetricValue.length > 0) {
            listOfAllVertices.push(listOfMetricValue);
        }

    }

    let maxWindowSize = -1;

    for (let j = 0; j < listOfAllVertices.length; j++) {

        //maximum window size is minimum of dataset size
        if (maxWindowSize < 0 || maxWindowSize > listOfAllVertices[j].length)
            maxWindowSize = listOfAllVertices[j].length;
    }

    $("#movingAverageSelector").attr("max", maxWindowSize);
    $("#movingAverageSelector").val(myConfig.myWindowSize).trigger("input");
    $("#sliderInput").attr("max", maxWindowSize);

    $(document).one("click", "#calcMovingAverage", function () {

        let windowSize = parseInt($("#movingAverageSelector").val());

        if (windowSize === myConfig.myWindowSize)
            return;

        if (listOfAllVertices.length > 0 && windowSize !== 0) {

            let res = movingAverage(listOfAllVertices, windowSize);

            myCharts.get("plot" + myConfig.myPlotId)
                .setOption({
                    dataset: {
                        id: 'dataset_movingAverage',
                        source: res
                    }, myChartConfig: {
                        myWindowSize: windowSize
                    },
                });


            for (let i = 0; i < myConfig.myVertices.length && myConfig.myVertices[i] !== null; i++) {

                myCharts.get("plot" + myConfig.myPlotId).setOption({
                    dataset: {
                        id: 'dataset_movingAverage' + i,
                        fromDatasetId: 'dataset_movingAverage',
                        transform: {
                            type: 'filter',
                            config: {dimension: 'vertex', '=': myConfig.myVertices[i].id}
                        }
                    },
                    series: {
                        id: myConfig.myVertices[i].id,
                        type: 'line',
                        step: false,
                        datasetId: 'dataset_movingAverage' + i,
                    }
                })

            }


            myCharts.get("plot" + myConfig.myPlotId).resize();

        } else {
            for (let i = 0; i < myConfig.myVertices.length && myConfig.myVertices[i] !== null; i++) {

                myCharts.get("plot" + myConfig.myPlotId).setOption({
                    series: {
                        id: myConfig.myVertices[i].id,
                        type: 'line',
                        step: 'end',
                        datasetId: 'dataset_vertex' + (i + 1),
                    }
                });

            }
        }

        myCharts.get("plot" + myConfig.myPlotId).setOption({
            myChartConfig: {
                myWindowSize: windowSize
            },
        });

    })

}

/**
 * Calculate moving average.
 *
 * @param listOfAllVertices list of vertices to be calculated
 * @param movingWindowSize window size of the moving average
 *
 * @returns data points with applied moving average
 */
function movingAverage(listOfAllVertices, movingWindowSize) {

    let resultList = [];

    for (let i = 0; i < listOfAllVertices.length; i++) {
        let subList = [];


        if (listOfAllVertices[i].length >= movingWindowSize) {

            for (let k = 0; k < listOfAllVertices[i].length - movingWindowSize + 1; k++) {
                let value = 0.0;
                let from = 0;
                let to = 0;

                for (let j = k; j < k + movingWindowSize; j++) {
                    value += listOfAllVertices[i][j].value;
                    from += listOfAllVertices[i][j].from;
                    to += listOfAllVertices[i][j].to;

                }
                let data = {
                    vertex: listOfAllVertices[i][0].vertex,
                    from: Math.round(from / movingWindowSize),
                    to: Math.round(to / movingWindowSize),
                    value: value / movingWindowSize
                }
                subList.push(data);
            }

        } else {
            subList = listOfAllVertices[i];
        }

        resultList = resultList.concat(subList);
    }

    return resultList;
}

/**---------------------------------------------------------------------------------------------------------------------
 * Manage metrics
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Manage of adding new metric.
 *
 * @param request the configuration of the metric
 */
function addGraph(request) {

    let sidebarLength = document.querySelectorAll(".sidebar-content > li").length;
    let sidebarLi = document.querySelectorAll(".sidebar-content > li").item(sidebarLength - 2);
    let ul = document.createElement("ul");
    let metricLi = document.createElement("li");
    let dbNameLi = document.createElement("li");

    metricLi.appendChild(document.createTextNode("Metric: " + "\u00A0" + request.metric.toString()));
    dbNameLi.appendChild(document.createTextNode("Data:   " + "\u00A0\u00A0\u00A0\u00A0" + request.dbName.toString()));
    ul.appendChild(metricLi);
    ul.appendChild(dbNameLi);

    sidebarLi.appendChild(ul);

    requestCall(request);

}


/**
 * Make a metric request to the server, if there is no data buffered.
 *
 * @param request a configuration for the metric
 */
function requestCall(request) {

    loading($("#addButtonField"));
    let cachedPosition = bufferCheck(request);
    let plotId = addGraphPlot();

    for (let chart of myCharts.values()) {
        chart.resize();
    }

    //request only when no matching configuration is cached
    if (cachedPosition !== -1) {

        bufferedMetrics[cachedPosition].plotIds.push(plotId);

        if (request.filters.length === 1) {
            drawChart(request.filters[0], "", plotId);
        } else if (request.filters.length >= 2) {
            drawChart(request.filters[0], request.filters[1], plotId);
        } else {
            drawChart("", "", plotId);
        }

        finished($("#addButtonField"));

    } else {
        $.ajax({
            url: 'http://localhost:2342/metric/',
            datatype: 'json',
            type: "post",
            contentType: "application/json",
            data: JSON.stringify(request),

            success: function (response) {

                saveMetric(request.dbName, request.metric, request.timestamp1, request.timestamp2, response, plotId);

                if (request.filters.length === 1) {
                    drawChart(request.filters[0], "", plotId);
                } else if (request.filters.length >= 2) {
                    drawChart(request.filters[0], request.filters[1], plotId);
                } else {
                    drawChart("", "", plotId);
                }
            },
            complete: function () {
                finished($("#addButtonField"));
            }

        });
    }

}

/**
 * Add new plot.
 *
 * @returns index of the plot
 */
function addGraphPlot() {

    if (childContainerCount >= 4) {
        return 0;
    }

    let newId = 1;
    while (newId <= 4) {
        if (!document.getElementById(`plot${newId}`)) {
            break;
        }
        newId++;
    }
    const newChildContainer = document.createElement("div");
    newChildContainer.classList.add("child-container");
    newChildContainer.id = `plot${newId}`;
    parentContainer.appendChild(newChildContainer);

    childContainerCount++;

    updateLayout();

    return newId;
}

/**
 * Delete chart by index of Echarts instance in myCharts.
 *
 * @param index chart index in myCharts
 */
function deleteGraphPlot(index) {
    if (childContainerCount < 1) return;

    parentContainer.removeChild(parentContainer.childNodes[index + 1]);
    childContainerCount--;

    updateLayout();
}

/**---------------------------------------------------------------------------------------------------------------------
 * Buffer data
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Buffer data of a metric evolution server response.
 *
 * @param reqSource database name
 * @param reqMetric metric
 * @param reqFrom first timestamp of interval
 * @param reqTo last timestamp of interval
 * @param response metric evolution
 * @param plotId id to connect with ECharts instance
 */
function saveMetric(reqSource, reqMetric, reqFrom, reqTo, response, plotId) {

    const metric = {
        data: response.data,
        metric: reqMetric,
        vertices: response.vertices,
        from: response.from,
        to: response.to,
        source: reqSource,
        centricMetric: response.centricMetric,
        plotIds: [plotId],
        allVertices: response.allVertices
    };

    bufferedMetrics.push(metric);
}

/**
 * Check if metric data is already buffered.
 *
 * @param request metric configuration
 * @returns -1 if metric isn't buffered, otherwise index of metric in bufferedMetrics
 */
function bufferCheck(request) {

    let cachedPosition = -1;
    let found = false;

    let timestamp1 = -9223372036854776000; //minimum value
    let timestamp2 = 9223372036854776000; //maximum value

    if ($("#predicateSelector").val() !== "all") {
        timestamp1 = new Date(request.timestamp1 + "Z").getTime();

        if ($("#predicateSelector").val() !== "asOf") {
            timestamp2 = new Date(request.timestamp2 + "Z").getTime();
        }
    }

    //iterate through all buffered metrics
    for (let i = 0; i < bufferedMetrics.length && !found; i++) {

        //check if source is identical
        if (bufferedMetrics[i].source === request.dbName) {

            //check if metric is identical
            if (bufferedMetrics[i].metric === request.metric) {

                //check if request is in range of time
                if (bufferedMetrics[i].from <= timestamp1 && bufferedMetrics[i].to >= timestamp2) {

                    //check if all vertices are buffered
                    if (bufferedMetrics[i].allVertices) {

                        cachedPosition = i;
                        found = true;
                    }
                    //check if request filters are already buffered
                    else if (request.filters.length > 0 && isSubset(bufferedMetrics[i].vertices.map(vertex => vertex.id), request.filters)) {

                        cachedPosition = i;
                        found = true;
                    }

                }

            }

        }

    }

    return cachedPosition;
}

/**---------------------------------------------------------------------------------------------------------------------
 * Chart Drawing
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Manage visualization.
 *
 * @param vertexId1 first vertex which metric to be drawn
 * @param vertexId2 second vertex which metric to be drawn
 * @param plotId the plot id to draw into
 */
function drawChart(vertexId1, vertexId2, plotId) {

    let bufferedData = bufferedMetrics[getBufferedDataIndex(plotId)];
    let vertex1;

    if (vertexId1 === "") {

        if (bufferedData.vertices.length > 0) {
            vertex1 = bufferedData.vertices[0];
        }
    } else {
        vertex1 = getVertexById(bufferedData.vertices, vertexId1);
    }

    let vertex2 = getVertexById(bufferedData.vertices, vertexId2);
    let dataAvailable = true;
    let vertices = [vertex1, vertex2];

    let filteredData = bufferedData.data.filter((vertex) =>
        vertices && vertices.some((filterVertex =>
            filterVertex && vertex.vertex === filterVertex.id)));

    let from = getFirstTimestamp(vertices, filteredData);
    let to = getLastTimestamp(vertices, filteredData);
    let step = getGranularity(from, to);


    let data = getVirtualData(filteredData, from, to, step);

    if (vertex1 === null && vertex2 === null) {
        if (data.length > 0) {
            drawChart1(from, to, data, bufferedData.vertices[0], plotId);
        } else {
            dataAvailable = false;
            alert("No data to visualize");
        }
    } else if (vertex1 === null && vertex2 !== null) {
        if (data.length > 0) {
            drawChart1(from, to, data, vertex2, plotId);
        } else {
            dataAvailable = false;
            alert("No data to visualize.");
        }
    } else if (vertex1 !== null && vertex2 === null) {
        if (data.length > 0) {
            drawChart1(from, to, data, vertex1, plotId);
        } else {
            dataAvailable = false;
            alert("No data to visualize.");
        }
    } else if (vertex1 !== null && vertex2 !== null) {
        if (data.length > 0) {
            drawChart2(from, to, data, vertex1, vertex2, plotId);
        } else {
            dataAvailable = false;
            alert("No data to visualize.");
        }
    } else {
        dataAvailable = false;
        alert("Unknown error.");
    }

    if (!dataAvailable) {
        let myChart = echarts.init(document.getElementById("plot" + plotId));
        myCharts.set("plot" + plotId, myChart);
    }
}

/**
 * Draw metric evolution of single vertex.
 *
 * @param from the first timestamp of the evolution
 * @param to the last timestamp of the evolution
 * @param data the metric evolution
 * @param vertex the vertex which metric is drawn
 * @param plotId the plot id to draw into
 */
function drawChart1(from, to, data, vertex, plotId) {
    let bufferedMetric = bufferedMetrics[getBufferedDataIndex(plotId)];

    let myChart = echarts.init(document.getElementById("plot" + plotId));

    let labels = getLabels([vertex, null]);

    let option = {
        dataset: [
            {
                id: 'dataset_raw',
                source: data
            },
            {
                id: 'dataset_vertex1',
                fromDatasetId: 'dataset_raw',
                transform: {
                    type: 'filter',
                    config: {dimension: 'vertex', '=': vertex.id}
                }
            },
        ],
        useUTC: true,
        title: {
            text: "Graph " + plotId
        },
        legend: getLegend(labels[0], labels[1]),
        tooltip: {
            trigger: 'axis',
        },
        myChartConfig: {
            myPlotId: plotId,
            myVertices: [vertex, null],
            myVerticesLabel: labels,
            myWindowSize: 0,
            myData: data,
        },
        toolbox: {
            show: true,
            feature: {
                dataView: {show: true, readOnly: true},
                saveAsImage: {show: true},
                myVertexSelector: {
                    show: true,
                    title: 'select vertices',
                    icon: "M32.26,52a2.92,2.92,0,0,1-2.37-1.21l-3.48-4.73h-.82L22.11,50.8a2.93,2.93,0,0,1-3.5,1L13,49.45a2.93,2.93,0,0,1-1.78-3.17l.89-5.8-.59-.59-5.8.89A2.93,2.93,0,0,1,2.55,39L.23,33.39a2.92,2.92,0,0,1,1-3.5l4.73-3.48v-.82L1.21,22.11a2.92,2.92,0,0,1-1-3.5L2.55,13a2.93,2.93,0,0,1,3.17-1.78l5.8.89,.59-.59-.89-5.8A2.93,2.93,0,0,1,13,2.55L18.61.23a2.93,2.93,0,0,1,3.5,1l3.48,4.74h.82l3.48-4.73a2.93,2.93,0,0,1,3.5-1L39,2.55a2.93,2.93,0,0,1,1.78,3.17l-.89,5.8.59,.59,5.8-.89A2.93,2.93,0,0,1,49.45,13l2.32,5.61a2.92,2.92,0,0,1-1,3.5l-4.73,3.48v.82l4.73,3.48a2.92,2.92,0,0,1,1,3.5L49.45,39a2.93,2.93,0,0,1-3.17,1.78l-5.8-.89-.59.59,.89,5.8A2.93,2.93,0,0,1,39,49.45l-5.61,2.32A2.82,2.82,0,0,1,32.26,52Zm-17-5.93,4.09,1.69,3.3-4.49a2.94,2.94,0,0,1,2.37-1.21H27a3,3,0,0,1,2.37,1.2l3.3,4.5,4.09-1.69-.85-5.51A3,3,0,0,1,36.68,38L38,36.69a3,3,0,0,1,2.53-.83l5.51.85,1.69-4.09-4.49-3.3A2.94,2.94,0,0,1,42.06,27v-1.9a2.94,2.94,0,0,1,1.21-2.37l4.49-3.3L46.07,15.3l-5.51.84A3,3,0,0,1,38,15.31L36.69,14a3,3,0,0,1-.83-2.53l.85-5.51L32.62,4.24l-3.3,4.5A3,3,0,0,1,27,9.94h-1.9a2.94,2.94,0,0,1-2.37-1.21l-3.3-4.49L15.29,5.93l.85,5.51A3,3,0,0,1,15.31,14L14,15.31a3,3,0,0,1-2.53.83L5.93,15.3,4.24,19.38l4.49,3.3a2.94,2.94,0,0,1,1.21,2.37V27a2.94,2.94,0,0,1-1.21,2.37l-4.49,3.3,1.69,4.09,5.51-.85a2.94,2.94,0,0,1,2.53.83L15.31,38a2.94,2.94,0,0,1,.83,2.53Zm31.6-30.9Zm-.31-2h0ZM26,38A12,12,0,1,1,38,26,12,12,0,0,1,26,38Zm0-20a8,8,0,1,0,8,8A8,8,0,0,0,26,18Z",
                    onclick: function () {
                        chartConfiguration(this.model.parentModel.parentModel.option.myChartConfig);
                    }
                },
                myMovingAverage: {
                    show: true,
                    title: 'moving average',
                    icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2h-11z",
                    onclick: function () {
                        movingAverageCall(this.model.parentModel.parentModel.option.myChartConfig);
                    }
                }
            }
        },
        xAxis: {
            type: 'time',
            nameLocation: 'middle'
        },
        yAxis: {
            name: 'value',
        },
        dataZoom: [
            {
                type: 'slider',
            },
            {
                type: 'inside',
                filterMode: 'none'
            },
        ],
        series: [
            {
                id: vertex.id,
                name: labels[0],
                type: 'line',
                step: 'end',
                datasetId: 'dataset_vertex1',
                showSymbol: false,
                encode: {
                    x: 'from',
                    y: 'value',
                    itemName: 'from',
                    tooltip: ['value']
                },
                color: '#ffa948'
            }
        ]
    };

    addMarkLine(option, "max", bufferedMetric.centricMetric.max, "#454746", from, to);
    addMarkLine(option, "avg", bufferedMetric.centricMetric.avg, "#454746", from, to);
    addMarkLine(option, "min", bufferedMetric.centricMetric.min, "#454746", from, to);

    myChart.setOption(option, true);
    myCharts.set("plot" + plotId, myChart);
}

/**
 * Draw metric evolution of two vertices.
 *
 * @param from the first timestamp of the evolutions
 * @param to the last timestamp of the evolutions
 * @param data the metric evolutions
 * @param vertex1 the first vertex which metric is drawn
 * @param vertex2 the second vertex which metric is drawn
 * @param plotId the plot id to draw into
 */
function drawChart2(from, to, data, vertex1, vertex2, plotId) {
    let bufferedMetric = bufferedMetrics[getBufferedDataIndex(plotId)];
    let myChart = echarts.init(document.getElementById("plot" + plotId));

    let labelVertex1 = vertex1.label;
    let labelVertex2 = vertex2.label;
    if (labelVertex1 === labelVertex2) {
        labelVertex1 += " 1";
        labelVertex2 += " 2";
    }

    let labels = getLabels([vertex1, vertex2]);

    let option = {
        dataset: [
            {
                id: 'dataset_raw',
                source: data
            },
            {
                id: 'dataset_vertex1',
                fromDatasetId: 'dataset_raw',
                transform: {
                    type: 'filter',
                    config: {dimension: 'vertex', '=': vertex1.id}
                }
            },
            {
                id: 'dataset_vertex2',
                fromDatasetId: 'dataset_raw',
                transform: {
                    type: 'filter',
                    config: {dimension: 'vertex', '=': vertex2.id},
                }
            }
        ],
        useUTC: true,
        title: {
            text: "Graph " + plotId
        },

        legend: getLegend(labels[0], labels[1]),
        tooltip: {
            trigger: 'axis',
        },
        myChartConfig: {
            myPlotId: plotId,
            myVertices: [vertex1, vertex2],
            myVerticesLabels: labels,
            myWindowSize: 0,
            myData: data,
        },
        toolbox: {
            show: true,
            feature: {
                dataView: {show: true, readOnly: true},
                saveAsImage: {show: true},
                myVertexSelector: {
                    show: true,
                    title: 'select vertices',
                    icon: "M32.26,52a2.92,2.92,0,0,1-2.37-1.21l-3.48-4.73h-.82L22.11,50.8a2.93,2.93,0,0,1-3.5,1L13,49.45a2.93,2.93,0,0,1-1.78-3.17l.89-5.8-.59-.59-5.8.89A2.93,2.93,0,0,1,2.55,39L.23,33.39a2.92,2.92,0,0,1,1-3.5l4.73-3.48v-.82L1.21,22.11a2.92,2.92,0,0,1-1-3.5L2.55,13a2.93,2.93,0,0,1,3.17-1.78l5.8.89,.59-.59-.89-5.8A2.93,2.93,0,0,1,13,2.55L18.61.23a2.93,2.93,0,0,1,3.5,1l3.48,4.74h.82l3.48-4.73a2.93,2.93,0,0,1,3.5-1L39,2.55a2.93,2.93,0,0,1,1.78,3.17l-.89,5.8.59,.59,5.8-.89A2.93,2.93,0,0,1,49.45,13l2.32,5.61a2.92,2.92,0,0,1-1,3.5l-4.73,3.48v.82l4.73,3.48a2.92,2.92,0,0,1,1,3.5L49.45,39a2.93,2.93,0,0,1-3.17,1.78l-5.8-.89-.59.59,.89,5.8A2.93,2.93,0,0,1,39,49.45l-5.61,2.32A2.82,2.82,0,0,1,32.26,52Zm-17-5.93,4.09,1.69,3.3-4.49a2.94,2.94,0,0,1,2.37-1.21H27a3,3,0,0,1,2.37,1.2l3.3,4.5,4.09-1.69-.85-5.51A3,3,0,0,1,36.68,38L38,36.69a3,3,0,0,1,2.53-.83l5.51.85,1.69-4.09-4.49-3.3A2.94,2.94,0,0,1,42.06,27v-1.9a2.94,2.94,0,0,1,1.21-2.37l4.49-3.3L46.07,15.3l-5.51.84A3,3,0,0,1,38,15.31L36.69,14a3,3,0,0,1-.83-2.53l.85-5.51L32.62,4.24l-3.3,4.5A3,3,0,0,1,27,9.94h-1.9a2.94,2.94,0,0,1-2.37-1.21l-3.3-4.49L15.29,5.93l.85,5.51A3,3,0,0,1,15.31,14L14,15.31a3,3,0,0,1-2.53.83L5.93,15.3,4.24,19.38l4.49,3.3a2.94,2.94,0,0,1,1.21,2.37V27a2.94,2.94,0,0,1-1.21,2.37l-4.49,3.3,1.69,4.09,5.51-.85a2.94,2.94,0,0,1,2.53.83L15.31,38a2.94,2.94,0,0,1,.83,2.53Zm31.6-30.9Zm-.31-2h0ZM26,38A12,12,0,1,1,38,26,12,12,0,0,1,26,38Zm0-20a8,8,0,1,0,8,8A8,8,0,0,0,26,18Z",
                    onclick: function () {
                        chartConfiguration(this.model.parentModel.parentModel.option.myChartConfig);
                    }
                },
                myMovingAverage: {
                    show: true,
                    title: 'moving average',
                    icon: "M1.5 1.5A.5.5 0 0 1 2 1h12a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.128.334L10 8.692V13.5a.5.5 0 0 1-.342.474l-3 1A.5.5 0 0 1 6 14.5V8.692L1.628 3.834A.5.5 0 0 1 1.5 3.5v-2zm1 .5v1.308l4.372 4.858A.5.5 0 0 1 7 8.5v5.306l2-.666V8.5a.5.5 0 0 1 .128-.334L13.5 3.308V2h-11z",
                    onclick: function () {
                        movingAverageCall(this.model.parentModel.parentModel.option.myChartConfig);
                    }
                }
            }
        },
        xAxis: {
            type: 'time',
            nameLocation: 'middle'
        },
        yAxis: {
            name: 'value',
        },
        dataZoom: [
            {
                type: 'slider',
            },
            {
                type: 'inside',
                filterMode: 'none'
            },
        ],
        series: [
            {
                id: vertex1.id,
                name: labels[0],
                type: 'line',
                step: 'end',
                datasetId: 'dataset_vertex1',
                showSymbol: false,
                encode: {
                    x: 'from',
                    y: 'value',
                    itemName: 'from',
                    tooltip: ['value']
                },
                color: '#ffa948'
            },
            {
                id: vertex2.id,
                name: labels[1],
                type: 'line',
                step: 'end',
                datasetId: 'dataset_vertex2',
                showSymbol: false,
                encode: {
                    x: 'from',
                    y: 'value',
                    itemName: 'from',
                    tooltip: ['value']
                },
                color: '#37abc8'
            }
        ]
    };
    addMarkLine(option, "max", bufferedMetric.centricMetric.max, "#454746", from, to);
    addMarkLine(option, "avg", bufferedMetric.centricMetric.avg, "#454746", from, to);
    addMarkLine(option, "min", bufferedMetric.centricMetric.min, "#454746", from, to);
    myChart.setOption(option, true);
    myCharts.set("plot" + plotId, myChart);

}

/**---------------------------------------------------------------------------------------------------------------------
 * Configure VirtualSelect Dropdowns
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Get vertices for virtual select dropdown.
 *
 * @param vertices list of vertices
 * @returns dropdown options in virtual select format
 */
function getVirtualSelectOptions(vertices) {

    let verticesMap = new Map();

    for (let vertex of vertices) {

        let label = vertex.label;
        let id = vertex.id;
        let property;

        if (vertex.property !== "") {
            property = vertex.property;

        } else {
            property = id;

        }

        let option = {
            label: property,
            value: id
        }

        if (verticesMap.has(label)) {
            verticesMap.get(label).push(option);
        } else {
            verticesMap.set(label, [option])
        }

    }

    let selectorOptions = Array.from(verticesMap.entries(), ([key, value]) => ({label: key, options: value}));

    return selectorOptions;

}

/**---------------------------------------------------------------------------------------------------------------------
 * Configure ECharts instance
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Get Echarts series for centric degrees.
 *
 * @param option ECharts option of instance to be changed
 * @param name name of the series
 * @param value scalar value of the series
 * @param color color of the series
 * @param minTime minimum timestamp of the series
 * @param maxTime maximum timestamp of the series
 */
function addMarkLine(option, name, value, color, minTime, maxTime) {

    let formattedValue = (Math.round(value * 100) / 100).toFixed(2);
    let temp = name + formattedValue;

    let markLine = {
        id: name,
        name: temp,
        type: 'line',
        data: [
            [minTime, value],
            [maxTime, value]
        ],
        showSymbol: false,
        tooltip: {
            show: false
        },
        color: color,
        lineStyle: {
            width: 1,
            type: "dotted",
        },
        z: 0
    };

    option.series.push(markLine);
    option.legend[1].data.push(temp);

}

/**
 * Get a legend for ECharts.
 *
 * @param label1 the label of the first vertex
 * @param label2 the label of the second vertex
 *
 * @returns  ECharts legend configuration
 */
function getLegend(label1, label2) {

    return [{
        data: [label1, label2],
    }, {
        data: [],
        top: "20%",
        right: "1%",
        orient: "vertical",
        icon: "none",
        textStyle: {
            padding: [5, 0, 5, 0],
            rich: {
                a: {
                    align: "center",
                    fontSize: "20%",
                    padding: [5, 0, 0, 0]
                }
            }
        },
        itemGap: 30,
        formatter: function (name) {
            let difference = name.length - 3;

            let value = name.slice(-difference);
            let string = name.slice(0, -difference).toUpperCase();
            return string + " \n" + "{a|" + value + "}";
        }
    }];
}

/**
 * Get labels from vertices.
 *
 * @param vertices list of vertices
 * @returns list of labels
 */
function getLabels(vertices) {
    let labels = [null, null];

    for (let i = 0; i < vertices.length; i++) {
        let label = null;

        if (vertices[i] !== null) {

            if (vertices[i].property !== "") {
                label = vertices[i].property;

            } else {
                label = vertices[i].label;
            }
        }

        labels[i] = label;
    }

    if (labels[0] === labels[1]) {
        labels[0] = labels[0] + " 1";
        labels[1] = labels[1] + " 2";
    }


    return labels;
}

/**---------------------------------------------------------------------------------------------------------------------
 * Create data points to visualization
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Calculate virtual data points for visualization of metric evolution.
 *
 * @param data metric evolution
 * @param from first change of interval
 * @param to last change of interval
 * @param step step size for virtual points
 * @returns virtual data points
 */
function getVirtualData(data, from, to, step) {

    let virtualData = [];
    let sampling = false;
    let length = data.length;

    if (data.length > 3000) {
        sampling = true;
        step *= 0.5;
    }


    let counter = 0;
    let counter2 = 0;

    let tempMetrics = [];

    for (let i = from; i <= to; i += step) {
        if (data.length === 0)
            break;

        let j = 0;

        while (j < data.length) {
            let currentMetric = data[j];

            if (currentMetric.from > (i + step)) {

                break;
            }

            if (!sampling && !containsObject(tempMetrics, currentMetric)) {
                tempMetrics.push(currentMetric);

                let l = 0;
                while (l < tempMetrics.length) {

                    if (data[l].to > currentMetric.from) {
                        let timestampFrom = tempMetrics[tempMetrics.length - 1].from < from ?
                            from : tempMetrics[tempMetrics.length - 1].from;
                        virtualData.push({
                            vertex: tempMetrics[l].vertex,
                            from: timestampFrom,
                            to: tempMetrics[l].to,
                            value: tempMetrics[l].value
                        });

                        counter++;
                    } else {

                        removeObject(tempMetrics, data[l]);
                        removeObject(data, data[l]);

                        l--;
                        j--;

                    }
                    l++;
                }
            }

            if (currentMetric.from < i && currentMetric.to > i) {

                virtualData.push({
                    vertex: currentMetric.vertex,
                    from: i,
                    to: currentMetric.to,
                    value: currentMetric.value
                });
                counter2++;

            }
            j++;
        }
    }

    return virtualData;
}

/**
 * Get first change of a given metric interval.
 *
 * @param vertices list of temporal vertices to be considered
 * @param data metric evolution
 *
 * @returns first change in UNIX Epoch milliseconds
 */
function getFirstTimestamp(vertices, data) {
    let minTime = 9223372036854776000;

    let found;

    for (let vertex of vertices) {

        if (vertex !== null) {


            found = false;

            for (let j = 0; j < data.length && !found; j++) {

                if (vertex.id === data[j].vertex) {

                    if (data[j].to < minTime) {
                        minTime = data[j].to;


                    }

                    found = true;
                }

            }

        }

    }

    return minTime;
}

/**
 * Get last change of a given metric interval.
 *
 * @param vertices list of temporal vertices to be considered
 * @param data metric evolution
 * @returns last change in UNIX Epoch milliseconds
 */
function getLastTimestamp(vertices, data) {
    let maxTime = 0;
    let found;


    for (let vertex of vertices) {

        if (vertex !== null) {

            found = false;

            for (let j = data.length - 1; j >= 0 && !found; j--) {

                if (vertex.id === data[j].vertex) {

                    if (data[j].from > maxTime) {
                        maxTime = data[j].from;

                    }
                    found = true;

                }

            }

        }

    }


    return maxTime;
}


/**---------------------------------------------------------------------------------------------------------------------
 * Helper functions
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Get step size of given interval for 1000 timestamps.
 *
 * @param from first timestamp of interval
 * @param to last timestamp of interval
 *
 * @returns size of a time step
 */
function getGranularity(from, to) {
    let interval = to - from;
    return interval / 1000;
}

/**
 * Remove specific element from array.
 *
 * @param arr the array that contains the element
 * @param obj the element to be removed
 *
 * @returns true if element was removed otherwise false
 */
function removeObject(arr, obj) {
    for (let i = 0; i < arr.length; i++) {
        if (JSON.stringify(arr[i]) === JSON.stringify(obj)) {
            arr.splice(i, 1);
            return true;
        }
    }
    return false;
}

/**
 * Check if specific element is present in array.
 *
 * @param arr the array
 * @param obj the element to be checked
 *
 * @returns true if element is in array otherwise false
 */
function containsObject(arr, obj) {
    for (let i = 0; i < arr.length; i++) {
        if (JSON.stringify(arr[i]) === JSON.stringify(obj)) {
            return true;
        }
    }
    return false;
}

let isSubset = (arr, target) => target.every(v => arr.includes(v));

/**
 * Get a vertex by its id.
 *
 * @param vertices list of vertices
 * @param id id of the vertex
 * @returns the vertex if there is a matching one
 */
function getVertexById(vertices, id) {
    let res = null;

    for (let vertex of vertices) {
        if (vertex.id === id) {
            res = vertex
        }
    }

    return res;
}

/**
 * Get index of data in bufferedMetrics by plotId.
 *
 * @param plotId plotId of ECharts instance
 * @returns -1 if plotId isn't assigned to bufferedMetrics, otherwise index of data in bufferedMetrics
 */
function getBufferedDataIndex(plotId) {
    let index = -1;

    for (let i = 0; i < bufferedMetrics.length; i++) {
        if (bufferedMetrics[i].plotIds.includes(plotId)) {
            index = i;
        }
    }

    return index;
}

/**
 * Load meta information into graph configuration and sidebar.
 */
function loadModal() {
    VirtualSelect.init({
        ele: "#vertices",
        search: true,
        multiple: true,
        showSelectedOptionsFirst: true,
        searchGroup: true,
        disable: true,
        options: [],
    });

    loadDatabaseAndVertices();
    addGraphToSidebar();

}

/**---------------------------------------------------------------------------------------------------------------------
 * Utility Functions
 *-------------------------------------------------------------------------------------------------------------------*/

/**
 * Synchronize slider and input field of moving average selector.
 */
function updateInput() {
    let slider = document.getElementById("movingAverageSelector");
    let input = document.getElementById("sliderInput");

    if (slider.value !== input.value) {
        input.value = slider.value;
    }
}

/**
 * Synchronize slider and input field of moving average selector.
 */
function updateSlider() {
    let slider = document.getElementById("movingAverageSelector");
    let input = document.getElementById("sliderInput");

    if (input.value !== slider.value) {
        slider.value = input.value;
    }
}

/**
 * Disable addGraph button while server calculation is running.
 *
 * @param el the element that holds addGraph.
 */
const loading = (el) => {
    // disable button
    el.find(".buttonContent").hide();
    //el.prop("disabled", true);
    $(".AddGraphButton").prop("disabled", true);
    $("#addGraphIcon").addClass("disabled");
    // add spinner to button
    el.append(
        `<div class="loading"><span class="spinner-border spinner-border-sm" role="status"></span> Loading...</div>`
    );
}

/**
 * Enable addGraph button after server response is finished.
 *
 * @param el
 */
const finished = (el) => {
    el.find(".loading").remove();
    el.find(".buttonContent").show();
    $(".AddGraphButton").prop("disabled", false);
    $("#addGraphIcon").removeClass("disabled");
}


/**
 * Rearrange layout of multiple charts.
 */
function updateLayout() {
    switch (childContainerCount) {
        case 1:
            parentContainer.classList.remove("two-up", "three-up", "four-up");
            break;
        case 2:
            parentContainer.classList.remove("three-up", "four-up");
            parentContainer.classList.add("two-up");
            break;
        case 3:
            parentContainer.classList.remove("two-up", "four-up");
            parentContainer.classList.add("three-up");
            break;
        case 4:
            parentContainer.classList.remove("two-up", "three-up");
            parentContainer.classList.add("four-up");
            break;
    }
}



