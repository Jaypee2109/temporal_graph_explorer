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
package org.gradoop.flink.algorithms.gelly.functions;

import org.apache.flink.api.java.functions.FunctionAnnotation;
import org.gradoop.common.model.api.entities.Edge;
import org.gradoop.common.model.impl.id.GradoopId;
import org.gradoop.common.model.impl.properties.PropertyValue;

/**
 * Maps Gradoop edge to a Gelly edge consisting of Gradoop source and target
 * identifier and {@link PropertyValue} as edge value.
 *
 * @param <E>  Gradoop edge type.
 */
@FunctionAnnotation.ForwardedFields("sourceId->f0;targetId->f1")
@FunctionAnnotation.ReadFields("properties")
public class EdgeToGellyEdgeWithPropertyValue<E extends Edge> implements EdgeToGellyEdge<E, PropertyValue> {
  /**
   * Property key to get the value for.
   */
  private final String propertyKey;

  /**
   * Reduce object instantiations.
   */
  private final org.apache.flink.graph.Edge<GradoopId, PropertyValue> reuseEdge;

  /**
   * Constructor.
   *
   * @param propertyKey property key for get property value
   */
  public EdgeToGellyEdgeWithPropertyValue(String propertyKey) {
    this.propertyKey = propertyKey;
    this.reuseEdge = new org.apache.flink.graph.Edge<>();
  }

  @Override
  public org.apache.flink.graph.Edge<GradoopId, PropertyValue> map(E edge) {
    reuseEdge.setSource(edge.getSourceId());
    reuseEdge.setTarget(edge.getTargetId());
    reuseEdge.setValue(edge.getPropertyValue(propertyKey));
    return reuseEdge;
  }
}
