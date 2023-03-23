package org.gradoop.demo.server.functions;

import org.apache.flink.api.common.functions.FilterFunction;
import org.gradoop.common.model.api.entities.Edge;
import org.gradoop.common.model.api.entities.Element;
import org.gradoop.common.model.impl.id.GradoopId;

import java.util.ArrayList;

public class EdgeFilter<E extends Element & Edge> implements FilterFunction<E> {

    private final ArrayList<GradoopId> filterIds;

    public EdgeFilter(String[] filter){
        this.filterIds = new ArrayList<>();

        for(String vertex: filter){
            filterIds.add(GradoopId.fromString(vertex));
        }
    }

    @Override
    public boolean filter(E e) throws Exception {

        return new BySourceIdMultiple<E>(filterIds).filter(e) || new ByTargetIdMultiple<E>(filterIds).filter(e);

    }
}
