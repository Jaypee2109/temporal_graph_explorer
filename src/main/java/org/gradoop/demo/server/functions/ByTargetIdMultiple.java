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
package org.gradoop.demo.server.functions;

import org.gradoop.common.model.api.entities.Edge;
import org.gradoop.common.model.impl.id.GradoopId;
import org.gradoop.flink.model.impl.functions.filters.CombinableFilter;

import java.util.ArrayList;

/**
 * Filters edges having the specified target vertex id.
 *
 * @param <E> edge type
 */
public class ByTargetIdMultiple<E extends Edge> implements CombinableFilter<E> {
    /**
     * Vertex id to filter on
     */
    private final ArrayList<GradoopId> targetIds;

    /**
     * Constructor
     *
     * @param targetIds vertex ids to filter on
     */
    public ByTargetIdMultiple(ArrayList<GradoopId> targetIds) {

        this.targetIds = targetIds;
    }

    @Override
    public boolean filter(E e) throws Exception {

        boolean found = false;

        for(GradoopId id: targetIds){
            if(e.getTargetId().equals(id))
                found = true;
        }
        return found;
    }
}
