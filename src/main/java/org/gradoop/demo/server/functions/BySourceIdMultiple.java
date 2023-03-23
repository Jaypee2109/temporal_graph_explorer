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
import java.util.List;

/**
 * Filters edges having the specified source vertex id.
 *
 * @param <E> edge type
 */
public class BySourceIdMultiple<E extends Edge> implements CombinableFilter<E> {
    /**
     * Vertex id to filter on
     */
    private final ArrayList<GradoopId> sourceIds;

    /**
     * Constructor
     *
     * @param sourceIds vertex ids to filter on
     */
    public BySourceIdMultiple(ArrayList<GradoopId> sourceIds) {
        this.sourceIds = sourceIds;
    }

    @Override
    public boolean filter(E e) throws Exception {

        boolean found = false;

        for(GradoopId id: sourceIds){
            if(e.getSourceId().equals(id))
                found = true;
        }

        return found;
    }
}
