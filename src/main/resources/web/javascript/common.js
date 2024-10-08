/*
 * Copyright © 2014 - 2021 Leipzig University (Database Research Group)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**------------------
 * Global Values
 *-------------------*/

/**
 * Buffers the last graph response from the server to improve redrawing speed.
 */
let bufferedData;

/**
 * Default value for the center of the leaflet map (Manhattan). For Leipzig (Germany) use
 * [12.38, 51.33].
 *
 * @type {number[]}
 */
let leafletCenter = [-73.9559308, 40.7747878];

let eChartInstance;

let cytoscapeInstance;

let eChartsOption = {};

let defaultVertexDiameter = 60;

let maxVertexDiameter = 120;

/**----------------
 * Callbacks
 *------------------*/

/**
 * Whenever one of the view options is changed, redraw the graph
 */
$(document).on("change", '.redraw', function () {
    if (bufferedData) {
        drawGraph(bufferedData, false);
    }
});

/**---------------------
 * Utility Functions
 *-----------------------*/

/**
 * Get the selected database
 *
 * @returns selected database name
 */
function getSelectedDatabase() {
    return $('#databaseName').val();
}

/**
 * Retrieve the values of the specified element as Array
 *
 * @param element the html element
 * @returns {Array}
 */
function getValues(element) {
    return $(element).val() || []
}

/**
 * Builds the eCharts environment.
 */
function buildECharts() {
    isEChartsInUsage = true;
    eChartInstance = echarts.init(document.getElementById('canvas'));

    eChartsOption = getEChartsOptions(false);

    if (eChartsOption && typeof eChartsOption === "object") {
        eChartInstance.setOption(eChartsOption);
    }
}

function buildCytoscape() {
    isEChartsInUsage = false;

    cytoscapeInstance = cytoscape({
        container: document.getElementById('canvas'),
        style: cytoscape.stylesheet()
            .selector('node')
            .css({
                // define label content and font
                'content': function (node) {

                    let labelString = node.data('label');

                    let properties = node.data('properties');

                    if (properties['count'] != null) {
                        labelString += ' (' + properties['count'] + ')';
                    }
                    return labelString;
                },
                // if the count shall effect the vertex size, set font size accordingly
                'font-size': getFontSize,
                'text-valign': 'center',
                'color': 'black',
                // set background color according to color map
                'background-color': function (node) {
                    return node.data('color');
                },
                'width': getVertexDiameter,
                'height': getVertexDiameter,
                'text-wrap': 'wrap',
            })
            .selector('edge')
            .css({
                'curve-style': 'bezier',
                // layout of edge and edge label
                'content': function (edge) {
                    if (!$('#showEdgeLabels').is(':checked')) {
                        return '';
                    }
                    let labelString = '';
                    labelString = edge.data('label');

                    let properties = edge.data('properties');

                    if (properties['count']) {
                        labelString += ' (' + properties['count'] + ')';
                    }

                    return labelString;
                },
                // if the count shall effect the vertex size, set font size accordingly
                'font-size': getFontSize,
                'line-color': function (edge) {
                    return edge.data('color');
                },
                // width of edges can be determined by property count
                // count specifies that the edge represents 1 or more other edges
                'width': function (edge) {
                    let selectedValue = $('#edgePropertyAdaptiveSelect').val();

                    if (selectedValue !== '_default' && edge.data('properties')[selectedValue]) {

                        let propValue = edge.data('properties')[selectedValue];
                        if (propValue !== null) {
                            let minValue = minMaxPropValue.edge[selectedValue].min;
                            let maxValue = minMaxPropValue.edge[selectedValue].max;

                            if (maxValue !== minValue) {
                                return getAdaptiveValue(minValue, maxValue, 3, 20, propValue);
                            }
                        }
                    }
                    return 3;
                },
                'target-arrow-shape': 'triangle',
                'target-arrow-color': '#000'
            })
            // properties of edges and vertices in special states, e.g. invisible or faded
            .selector('.faded')
            .css({
                'opacity': 0.25,
                'text-opacity': 0
            })
            .selector('.invisible')
            .css({
                'opacity': 0,
                'text-opacity': 0
            }),
        ready: function () {
            cytoscapeInstance = this;
            cytoscapeInstance.elements().unselectify();
            /* if a vertex is selected, fade all edges and vertices
            that are not in direct neighborhood of the vertex */
            cytoscapeInstance.on('tap', 'node', nodeTap);
            cytoscapeInstance.on('tap', 'edge', edgeTap);

            // remove fading by clicking somewhere else
            cytoscapeInstance.on('tap', function (e) {
                if (e.target === cytoscapeInstance) {
                    cytoscapeInstance.elements().removeClass('faded');
                }
            });
        }
    });

    function getVertexDiameter(node) {
        let selectedValue = $('#vertexPropertyAdaptiveSelect').val();

        if (selectedValue !== '_default' && node.data('properties')[selectedValue]) {

            let propValue = node.data('properties')[selectedValue];
            if (propValue !== null) {
                let minValue = minMaxPropValue.vertex[selectedValue].min;
                let maxValue = minMaxPropValue.vertex[selectedValue].max;

                if (maxValue !== minValue) {
                    return getAdaptiveValue(minValue, maxValue, defaultVertexDiameter,
                        maxVertexDiameter, propValue) + 'px';
                }
            }
        }
        return defaultVertexDiameter + 'px';
    }

    function getFontSize(node) {
        let selectedValue = $('#vertexPropertyAdaptiveSelect').val();

        if (selectedValue !== '_default' && node.data('properties')[selectedValue]) {

            let propValue = node.data('properties')[selectedValue];
            if (propValue !== null) {
                let minValue = minMaxPropValue.vertex[selectedValue].min;
                let maxValue = minMaxPropValue.vertex[selectedValue].max;

                if (maxValue !== minValue) {
                    return getAdaptiveValue(minValue, maxValue, 4, 20, propValue);
                }
            }
        }
        return 10;
    }

    /**
     * Callback for tapping on a node.
     *
     * @param event
     */
    function nodeTap(event) {
        let node = event.target;
        let neighborhood = node.neighborhood().add(node);

        cytoscapeInstance.elements().addClass('faded');
        neighborhood.removeClass('faded');

        let ref = node.popperRef(); // used only for positioning
        let dummyDomEle = document.createElement('div');

        let tip = tippy(dummyDomEle, { // tippy options:
            // mandatory:
            trigger: 'manual', // call show() and hide() yourself
            getReferenceClientRect: ref.getBoundingClientRect,

            content: () => {
                let content = document.createElement('div');

                let qtipText = '';
                let label = this.data()['label'];

                if (label != null) {
                    qtipText += '<b>' + label + '</b><br>';
                }
                for (let [key, value] of Object.entries(this.data('properties'))) {
                    if (key === 'label') {
                        qtipText += '<b>' + value + '</b><br>';
                    } else if (key === 'id' || key === 'source' || key === 'target') {
                        // don't print
                    } else {
                        qtipText += key + ' : ' + value + '<br>';
                    }
                }

                qtipText += '<br>'
                qtipText += '<i>TPGM temporal attributes</i><br>'
                qtipText += 'tx_from : ' + this.data('tx_from') + '<br>';
                qtipText += 'tx_to : ' + this.data('tx_to') + '<br>';
                qtipText += 'val_from : ' + this.data('val_from') + '<br>';
                qtipText += 'val_to : ' + this.data('val_to') + '<br>';
                qtipText += '<br>';
                qtipText += '';


                content.innerHTML = qtipText;
                return content;
            }
        });
        tip.show();
    }

    /**
     * Callback for tapping on an edge.
     *
     * @param event
     */
    function edgeTap(event) {
        let edge = event.target;
        let nodes = edge.connectedNodes().add(edge);
        cytoscapeInstance.elements().addClass('faded');
        nodes.removeClass('faded');

        let ref = edge.popperRef(); // used only for positioning
        let dummyDomEle = document.createElement('div');

        let tip = tippy(dummyDomEle, { // tippy options:
            // mandatory:
            trigger: 'manual', // call show() and hide() yourself
            getReferenceClientRect: ref.getBoundingClientRect,

            // your custom options follow:

            content: () => {
                let content = document.createElement('div');

                let qtipText = '';
                let label = this.data('label');

                if (label != null) {
                    qtipText += '<b>' + label + '</b><br>';
                }

                for (let [key, value] of Object.entries(this.data('properties'))) {
                    qtipText += key + ' : ' + value + '<br>';
                }

                qtipText += '<br>'
                qtipText += '<i>TPGM temporal attributes</i><br>'
                qtipText += 'tx_from : ' + this.data('tx_from') + '<br>';
                qtipText += 'tx_to : ' + this.data('tx_to') + '<br>';
                qtipText += 'val_from : ' + this.data('val_from') + '<br>';
                qtipText += 'val_to : ' + this.data('val_to') + '<br>';

                content.innerHTML = qtipText;

                return content;
            }
        });

        tip.show();
    }
}

/**
 * Returns the eCharts option. If parameter {@code useLeaflet} is set to true, a configuration with
 * enabled Map-View using Leaflet is returned.
 *
 * @param useLeaflet the flag to activate the Map-View
 * @returns the eCharts configuration as object
 */
function getEChartsOptions(useLeaflet) {
    let options = {
        tooltip: {
            trigger: 'item',
            triggerOn: 'click',
        },
        series: [
            {
                name: 'Temporal Graph Explorer',
                type: 'graph',
                zoom: 1,
                edgeSymbol: ['circle', 'arrow'],
                edgeSymbolSize: [4, 10],
                edgeLabel: {
                    show: true,
                    position: "middle",
                    formatter: function (params) {
                        if (!$('#showEdgeLabels').is(':checked')) {
                            return '';
                        }
                        let labelString = '';
                        labelString = params.value[2]['label'];

                        if (params.value[2]['properties']['count']) {
                            labelString += ' (' + params.value[2]['properties']['count'] + ')';
                        }

                        return labelString;
                    }
                },
                selectedMode: 'single',
                lineStyle: {
                    width: 2,
                    opacity: 0.8,
                },
                data: [],
                links: [],
                roam: true,
                label: {
                    show: true,
                    position: "right",
                    formatter: function (params) {
                        let labelString = '';
                        labelString = params.value[2]['label'];

                        if (params.value[2]['properties']['count']) {
                            labelString += ' (' + params.value[2]['properties']['count'] + ')';
                        }

                        return labelString;
                    },
                },
                tooltip: {
                    formatter: function (params) {
                        let content = document.createElement('div');
                        let text = '';
                        let label = params.value[2]['label'];

                        if (label != null) {
                            text += '<b>' + label + '</b><br>';
                        }
                        for (let [key, value] of Object.entries(params.value[2]['properties'])) {
                            if (key === 'id' || key === 'source' || key === 'target') {
                                // don't print
                            } else {
                                text += key + ' : ' + value + '<br>';
                            }
                        }
                        text += '<br>'
                        text += '<i>TPGM temporal attributes</i><br>'
                        text += 'tx_from : ' + params.value[2]['tx_from'] + '<br>';
                        text += 'tx_to : ' + params.value[2]['tx_to'] + '<br>';
                        text += 'val_from : ' + params.value[2]['val_from'] + '<br>';
                        text += 'val_to : ' + params.value[2]['val_to'] + '<br>';
                        text += '<br>';

                        console.log(params);


                        content.innerHTML = text;

                        if (params.dataType === "node") {
                            let metricButton = document.createElement("button");
                            metricButton.textContent = "Calculate Metric";
                            metricButton.addEventListener("click", function (event) {
                                getMetric(params);
                            })

                            let paramsString = JSON.stringify(params.value[2]).replace(/"/g, '\\"');
                            console.log(paramsString)

                            content.classList.add('tooltip-active');
                            content.appendChild(metricButton);
                        }

                        return content;
                    }
                },
                labelLayout: {
                    hideOverlap: true,
                },
                autoCurveness: 30,
                emphasis: {
                    focus: 'adjacency',
                    lineStyle: {
                        width: 3,
                    },
                },
                blur: {
                    lineStyle: {
                        opacity: 0.6,
                    },
                    itemStyle: {
                        opacity: 0.6,
                    },
                },
            },
        ],
    };

    if (useLeaflet) {
        options.leaflet = {
            title: {
                text: "Graph Demo",
                subtext: "Test graph on maps",
                left: "center",
            },
            center: leafletCenter,
            zoom: 12,
            roam: true,
            tiles: [
                {
                    label: "OpenStreetMap",
                    urlTemplate:
                        "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
                    options: {
                        attribution:
                            '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles courtesy of <a href="http://hot.openstreetmap.org/" target="_blank">Humanitarian OpenStreetMap Team</a>',
                    },
                },
            ],
        };

        options.series[0].coordinateSystem = "leaflet";
    } else {
        options.series[0].layout = "force";
        options.series[0].force = {
            // initLayout: 'circular'
            // gravity: 0
            repulsion: 60,
        };

    }
    return options;
}

function loadDatabases() {
    $.get('http://localhost:2342/graphs', function (response) {
        let options = '';
        for (i = 0; i < response.length; i++) {
            options += '<option value="' + response[i] + '">' + response[i] + '</option>';
        }
        $('.databaseName').html(options);
    }, "json");
}

/**
 * Request existing datasets and their vertices.
 */
function loadDatabaseAndVertices() {
    $.get("http://localhost:2342/graphs", function (response) {
        let options = '';
        for (i = 0; i < response.length; i++) {
            options += '<option value="' + response[i] + '">' + response[i] + '</option>';
        }
        $('.databaseName').html(options);


        let defaultDatabase = $('.databaseName option:first').val();
        loadVertices(defaultDatabase);

        $('.databaseName').on("change", function () {
            let selectedDatabase = $(this).val();
            loadVertices(selectedDatabase);
        });
    }, "json");

}

function getAdaptiveValue(minValue, maxValue, smallestBound, highestBound, currentValue) {
    return ((highestBound - smallestBound) * currentValue +
            (smallestBound * maxValue - minValue * highestBound)) /
        (maxValue - minValue);
}

/**
 * Request vertices with labels of a temporal graph dataset.
 *
 * @param database the dataset to request the vertices from
 */
function loadVertices(database) {
    document.querySelector("#vertices").disable();

    $.ajax({
        url: "http://localhost:2342/vertices/" + database,
        dataType: "json",
        type: "get",
        stream: true,

        success: function (output) {

            document.querySelector("#vertices").setOptions(output);
            document.querySelector("#vertices").enable();
        }
    });
}

/**
 * Request degree of selected vertex.
 *
 * @param params the configuration
 *
 * @returns {boolean} false if request failed
 */
function getMetric(params) {

    let request = {
        dbName: getSelectedDatabase(),
        metric: "BOTH degree",
        predicate: "fromTo",
        timestamp1: params.value[2].val_from,
        timestamp2: params.value[2].val_to,
        filters: params.value[2].id
    };

    let queryString = new URLSearchParams(request).toString();

    window.location.href = "../html/metric.html?" + queryString;

    return false;
}

